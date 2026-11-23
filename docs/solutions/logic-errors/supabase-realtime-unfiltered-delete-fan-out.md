---
title: 필터도 RLS도 안 걸리는 Supabase Realtime DELETE를 이벤트마다 무효화하면 생기는 문제
date: 2026-11-17
category: logic-errors
module: Supabase Realtime + TanStack Query cache (src/realtime)
problem_type: logic_error
component: frontend
symptoms:
  - 다른 그룹에서 지운 행 하나하나가 이 기기의 items/lists/locations 재조회를 일으킴(사용자 수에 비례하는 재조회 폭주)
  - 캐시에 없는 DELETE를 모두 버리자 다른 목록(홈 카드)의 미완료 개수가 갱신되지 않음
  - 조회가 진행 중일 때 온 DELETE를 버리면, 그 조회 응답에 이미 지워진 행이 섞여 남음
  - 기본 invalidate(cancelRefetch true)가 이벤트마다 진행 중인 조회를 취소하고 다시 시작해 응답이 끝나지 않음
  - 트레일링 디바운스만 두면 DELETE가 계속 오는 동안 개수 갱신이 한 번도 발화하지 않음
root_cause: wrong_api
resolution_type: code_fix
severity: medium
tags: [supabase-realtime, postgres-changes, delete-event, rls, tanstack-query, invalidate-queries, cancel-refetch, debounce, multi-tenant]
---

# 필터도 RLS도 안 걸리는 Supabase Realtime DELETE를 이벤트마다 무효화하면 생기는 문제

## Problem
Supabase Realtime의 postgres_changes에서 DELETE 이벤트는 `filter`(예: `family_id=eq.X`)를 걸 수 없고 RLS 정책도 적용되지 않는다. payload의 `old`에는 기본 키만 온다. 그래서 구독한 모든 클라이언트가 **모든 그룹의** 삭제를 받는다. Task 11 설계는 "DELETE를 받으면 prefix를 무효화"였는데, 이는 다른 그룹의 삭제마다 이 기기의 재조회를 일으킨다. 그 뒤 리뷰가 다섯 번(A5/R2 → B4·pass-2 → F1 → M-4) 이어지며 매번 앞선 수정이 반대 방향으로 지나쳤다.

## Symptoms
- Task 11: DELETE는 필터 없이 구독하고, 받으면 `['items']`, `['lists']` 등 prefix를 무효화했다. 다른 그룹의 삭제도 모두 재조회로 이어진다(adversarial A5, red-team R2).
- R2/A5 수정 후(캐시에 없는 id는 무시): 다른 목록의 항목 삭제가 홈 카드 미완료 개수에 반영되지 않았다(B4). 조회가 진행 중일 때 온 삭제를 버려 응답에 지워진 행이 남았다(pass-2 combined finding).
- B4 수정 후(캐시에 없는 항목 DELETE마다 `['lists']` 무효화): 삭제 하나마다 무효화가 다시 일어났고, 기본 `cancelRefetch: true` 때문에 진행 중인 조회가 계속 취소·재시작되었다. 그동안 `isFetchingAny`가 참으로 남아 다음 DELETE도 "관련 있음"으로 처리되는 순환이 생겼다(F1).
- F1 수정 후(1초 트레일링 디바운스): 1초보다 촘촘하게 DELETE가 계속 오면 타이머가 끝없이 미뤄져 개수 갱신이 발화하지 않았다. 로그아웃 뒤에도 예약된 타이머가 남아 지운 캐시를 다시 조회할 수 있었다(M-4).

## What Didn't Work
- **"RLS가 어차피 payload를 가린다"고 보고 필터 없이 무효화만 하기**(Task 11 ruling): DELETE에는 RLS가 적용되지 않아 다른 그룹의 행 id와 삭제 시각이 그대로 온다. 비용을 "가끔 생기는 추가 재조회"로 추정했지만 실제로는 전체 사용자의 삭제 수에 비례한다.
- **캐시에 없는 DELETE는 모두 버리기**(R2/A5 첫 수정): 이 기기 캐시에 없는 행이어도 같은 그룹의 다른 목록 항목이면 홈 카드의 미완료 개수가 바뀐다. 또 조회가 진행 중이면 그 응답에 방금 지워진 행이 들어 있을 수 있는데, 아직 캐시에 없으니 버려진다.
- **캐시에 없는 DELETE마다 바로 무효화**(B4 첫 수정): 첫 문제(폭주)로 되돌아간다.
- **기본 옵션으로 `invalidateQueries`**: 기본값 `cancelRefetch: true`는 진행 중인 조회를 취소하고 새로 시작한다. 이벤트가 이어지면 조회가 끝나지 않는다.
- **트레일링 디바운스만**(F1): 연속 이벤트에서는 영원히 미뤄진다(starvation). 최대 대기 시간과 취소 경로가 필요하다.

## Solution
`src/realtime/apply-change.ts`의 `applyChange`가 DELETE를 아래 순서로 거른다.

1. **이 기기 캐시에 있는 행인지 확인한다.** 테이블마다 그 행이 들어 있을 수 있는 모든 캐시 prefix를 `DELETE_CACHES`(`apply-change.ts:89`)에 적는다. `list_locations`는 낙관적 캐시 `locations`뿐 아니라 읽기 전용 캐시 `allLocations`도 포함한다. `old.id`가 그 캐시들에 있으면(`isCachedId`, `apply-change.ts:75`) 평소 경로로 무효화한다. busy 가드는 그대로 적용된다(L1 learning 참고).
2. **캐시에 없어도, 그 prefix를 조회하는 중이면 관련 있는 것으로 본다**(`isFetchingAny`, `apply-change.ts:84`; 판정은 `apply-change.ts:137`). 응답에 지워진 행이 섞여 들어올 수 있기 때문이다. id가 없는 DELETE는 버린다.
3. **그 밖의 캐시에 없는 DELETE는 버린다.** 다만 `items` 테이블이면 홈 카드 개수만 `refreshCountsSoon`(`apply-change.ts:27`)으로 묶어서 갱신한다. 1초 트레일링 디바운스(`UNCACHED_DELETE_DEBOUNCE_MS`)에, 첫 이벤트 후 3초 최대 대기(`UNCACHED_DELETE_MAX_WAIT_MS`, `apply-change.ts:22-23`)를 둔다. 발화 시점에 큐가 바쁘면 건너뛴다(`apply-change.ts:41`). 타이머는 QueryClient별(`WeakMap`)로 하나다.
4. **Realtime이 일으키는 모든 무효화는 `REALTIME_INVALIDATE = { cancelRefetch: false }`(`apply-change.ts:12`)로 한다.** SUBSCRIBED 때의 전체 재조회(`use-family-realtime.ts`)도 같다.
5. **예약된 갱신은 취소할 수 있게 한다.** `cancelPendingRealtimeWork`를 구독 해제(`use-family-realtime.ts:59`)와 `clearUserCache`(`src/lib/query-client.ts:79`)에서 부른다.

INSERT/UPDATE는 `family_id` 필터로 구독하므로 이 문제가 없다(`use-family-realtime.ts:30-41`).

## Why This Works
이 기기 캐시와 무관한 DELETE는 화면에 영향을 줄 수 없다. 예외는 두 가지뿐이다. (a) 캐시가 아직 안 채워졌는데 채우는 중인 조회, (b) 행 자체는 캐시에 없지만 집계(홈 카드 개수)에 반영되는 경우다. (a)는 `isFetching`으로, (b)는 묶은 `['lists']` 갱신으로 다룬다. 그 밖의 DELETE는 모두 버려도 된다. 묶는 데 최대 대기가 있으므로 개수는 늦어도 3초 안에 맞춰진다. `cancelRefetch: false`라 이미 진행 중인 조회를 다시 시작하지 않는다. 그래서 이벤트 수와 상관없이 재조회 수가 유한하다.

다른 그룹의 행 id와 삭제 시각이 모든 클라이언트에 전달되는 것은 클라이언트 코드로 막을 수 없다(A5, `fixable:false`로 수용). 이 앱은 id가 UUID라 id만으로는 내용이 드러나지 않는다. 다만 Realtime DELETE를 "그룹 안의 이벤트"로 믿고 화면에 표시하거나 로그에 남기면 다른 그룹의 정보가 새어 나간다.

## Prevention
- 회귀 테스트: `__tests__/realtime/apply-change.test.ts`의 `DELETE events for rows that are not cached`, `uncached DELETE while a fetch for that cache is in flight (B4)`, `passes cancelRefetch: false for every realtime invalidation (F1)`, `uncached DELETE debounce limits (M-4)`가 위 1-5를 붙잡는다. `__tests__/realtime/use-family-realtime.test.tsx`의 `subscribes INSERT/UPDATE with family filter and DELETE without one`과 `cancels pending realtime work when the subscription is torn down (M-4)`도 함께 본다.
- 테스트가 잡지 못하는 경우: **새 Realtime 테이블을 추가할 때 `DELETE_CACHES`에 그 행이 들어 있을 수 있는 캐시 prefix를 빠짐없이 적는다.** 타입이 키는 강제하지만 값이 맞는지는 모른다. prefix 하나를 빠뜨리면 그 캐시에만 있는 행의 DELETE가 "캐시에 없음"으로 버려져 화면에 지워진 행이 남는다(`allLocations`가 그 예).
- 새로운 집계(다른 목록의 개수, 배지 등)가 다른 테이블의 DELETE에 영향을 받으면, 그 집계도 `refreshCountsSoon`처럼 묶은 갱신으로 처리한다. DELETE마다 바로 무효화하지 않는다.
- Realtime 경로에서 `invalidateQueries`를 새로 부르면 반드시 `REALTIME_INVALIDATE`를 넘긴다.
- DELETE payload의 `old`에는 PK 외의 값(`family_id`, `list_id`)이 없다고 가정한다. 이 값으로 대상을 고르려 하지 않는다.
- Realtime DELETE를 필터·RLS가 적용된 이벤트로 취급하지 않는다. 이 이벤트를 표시하거나 기록하는 기능을 만들 때는 먼저 이 기기 캐시에 있는 행인지 확인한다.

## Related Issues
- `docs/solutions/logic-errors/offline-queue-optimistic-state-clobbered-by-mid-queue-refetch.md` — 같은 파일의 busy 가드(큐가 바쁘면 Realtime이 낙관적 캐시를 건드리지 않음). 이 learning의 1-3단계 뒤에 그 가드가 적용된다.
- `docs/superpowers/specs/2026-11-10-cart-note-design.md`의 Realtime 절은 "DELETE를 받으면 해당 쿼리를 무효화"라고 적혀 있다. 이 learning 이전의 설계다.

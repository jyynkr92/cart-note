---
title: 오프라인 큐가 비기 전에 재조회·Realtime 쓰기가 낙관적 값을 덮는 문제
date: 2026-11-17
category: logic-errors
module: offline mutation queue (TanStack Query) + Supabase Realtime
problem_type: logic_error
component: frontend
symptoms:
  - 큐가 비면 마지막 mutation이 건드린 목록만 서버 값으로 맞춰지고, 앞서 건드린 목록은 낡은 값으로 남음
  - 오프라인 변경을 재생하는 중 다른 기기의 Realtime 이벤트가 체크한 항목을 미체크로 되돌리거나 지운 행을 되살렸다가 다시 바뀜
  - 지점을 연달아 추가하면 첫 요청이 끝날 때 두 번째 낙관적 지점 행이 잠깐 사라졌다가 돌아옴
  - 큐가 바쁜 상태에서 Realtime 재구독(SUBSCRIBED) 시 locations가 다시 조회되어 낙관적 행이 깜빡임
root_cause: concurrency
resolution_type: code_fix
severity: high
tags: [tanstack-query, optimistic-update, offline-queue, invalidate-when-idle, supabase-realtime, is-mutating]
---

# 오프라인 큐가 비기 전에 재조회·Realtime 쓰기가 낙관적 값을 덮는 문제

## Problem
모든 쓰기 mutation은 하나의 scope(`QUEUE_SCOPE`)를 공유해 한 번에 하나씩 순서대로 실행되고, 키는 모두 `['m', <엔티티>, <동작>]`로 시작한다(`src/lib/query-keys.ts`의 `mk`). 큐에 아직 끝나지 않은 mutation이 있는데 그 엔티티 쿼리를 다시 조회하거나 서버 값을 캐시에 쓰면, 서버는 대기 중인 변경을 모르기 때문에 낙관적 값이 덮인다. 같은 실수가 네 번 다른 경로로 반복되었다. 새 코드 경로나 새 낙관적 엔티티가 생길 때마다 이 규칙이 빠졌다.

## Symptoms
- Task 7: 큐가 비면 마지막 mutation의 목록만 무효화되어, 앞서 건드린 목록과 재시작 후 재개되었다가 실패한 mutation이 서버 값과 맞지 않았다.
- Task 11: Realtime INSERT/UPDATE가 `setQueryData`로 서버 행을 썼고, DELETE와 lists 이벤트는 항상 무효화했다. 오프라인 변경을 재생하는 동안 낙관적 값이 덮였다가 다시 돌아왔다.
- Task 13: 지점 mutation이 `onSuccess`에서 지점 쿼리를 무효화했고, Realtime도 `['locations']`를 조건 없이 무효화했다. 첫 요청이 끝날 때 두 번째 낙관적 행이 깜빡였다.
- 최종 리뷰 I4: SUBSCRIBED 때 재조회에서 제외하는 목록(busy skip)에 `locations`가 빠져 있었다.

## What Didn't Work
- **mutation별 키를 settle 때 무효화하기**(큐가 비었을 때만 실행하도록 막아도 마찬가지): 큐가 비는 순간 settle되는 것은 마지막 mutation 하나뿐이라 그 키만 갱신된다. 앞선 mutation들은 큐가 바쁠 때 settle되어 무효화를 건너뛰었다. (session history)
- **`onSuccess`에서 무효화하기**: 큐의 중간 mutation이 성공해도 실행된다. idle 확인을 완전히 우회한다. 새 엔티티(locations)는 기존 패턴(onSettled + invalidateWhenIdle)을 따르지 않고 이 방식으로 작성되었다.
- **Realtime 이벤트를 큐 상태와 상관없이 반영하기**: 서버 행은 대기 중인 낙관적 변경을 포함하지 않으므로, 반영하는 순간 낙관적 값이 사라진다.
- **busy 가드를 엔티티 목록을 손으로 적어 두는 곳마다 따로 두기**: `invalidateWhenIdle`의 prefix 목록, `apply-change.ts`의 `isBusy` 분기, `use-family-realtime.ts`의 `BUSY_SKIP`. 이 세 곳은 같은 엔티티 목록을 각자 들고 있어서, 엔티티를 추가할 때 하나만 빠져도 다시 깜빡인다(I4가 바로 그 경우).

## Solution
규칙: **낙관적으로 고치는 쿼리 prefix는 큐(`mk.all`)가 비어 있을 때만 서버 값으로 맞춘다.**

1. 큐 mutation의 서버 값 맞추기(무효화)는 `onSettled: () => invalidateWhenIdle(qc)`로만 한다(삭제된 목록의 items 캐시 제거 같은 정리는 `onSuccess`에 있을 수 있다). `invalidateWhenIdle`(`src/lib/mutation-utils.ts:48-54`)은 `qc.isMutating({ mutationKey: mk.all }) > 1`이면 아무것도 하지 않는다. 그렇지 않으면 `['items']`, `['lists']`, `['locations']`, `['allLocations']` prefix 전체를 무효화한다. 문턱이 `> 1`인 이유는 `onSettled` 시점에 settle 중인 mutation 자신이 아직 개수에 포함되기 때문이다. 대기 중이거나 일시정지된 mutation도 pending으로 센다(이번 세션의 결론).
2. 실패한 mutation은 예외다. `onError`에서 롤백한 뒤 그 mutation이 건드린 키는 큐 상태와 상관없이 무효화한다(`src/items/use-items.ts:87-92`, lists·locations도 같다). 재시작 후 재개된 mutation은 롤백 context가 없거나(`onMutate`가 끝나기 전에 영속화된 경우), 영속화된 스냅샷이 재시작 전 시점이라 낡았을 수 있기 때문이다.
3. Realtime(`src/realtime/apply-change.ts`)은 `isBusy(qc)`(`mk.all`의 pending 수가 0보다 큼)이면 items·lists·locations 캐시에 쓰지도, 무효화하지도 않는다. 이때 놓친 원격 변경은 큐가 비면 `invalidateWhenIdle`의 전체 재조회가 다시 맞춘다. `allLocations`는 낙관적 값이 없는 읽기 전용 캐시라 일부러 항상 무효화한다(`apply-change.ts:155-166`).
4. SUBSCRIBED 재조회(`src/realtime/use-family-realtime.ts:51`)는 큐가 바쁘면 `BUSY_SKIP = {onboarding, items, lists, locations}`을 제외한다.

## Why This Works
서버 상태로 다시 맞추는 일을 "큐가 비는 순간 한 번, 넓은 prefix로"로 모았다. 그래서 그 시점에는 대기 중인 낙관적 변경이 하나도 없고, 서버 응답에 모든 변경이 들어 있다. prefix 전체를 무효화하므로 어느 mutation이 어느 목록을 건드렸는지 기억할 필요도 없다. Realtime은 큐가 바쁜 동안 이벤트를 버리지만, 마지막 settle의 전체 재조회가 그 변경을 다시 가져오므로 결국 일치한다.

## Prevention
- 계약 테스트 `__tests__/lib/optimistic-queue-contract.test.tsx`가 이 규칙을 붙잡는다. 이 테스트는 `mk`의 두 번째 요소(`'items'`, `'lists'`, `'locations'`)에서 낙관적 엔티티 목록을 만든다. 그리고 엔티티마다 다음을 확인한다. (1) `invalidateWhenIdle`이 큐가 비면 그 prefix를 무효화하고, 다른 mutation이 대기 중이면 건드리지 않는다. (2) 큐가 바쁘면 모든 Realtime 이벤트가 그 캐시를 쓰거나 무효화하지 않는다. (3) 큐가 바쁘면 SUBSCRIBED 재조회가 그 prefix를 건너뛴다. 새 엔티티를 `mk`에 추가하고 `invalidateWhenIdle`이나 `BUSY_SKIP`에 등록하지 않으면 이 테스트가 실패한다.
- 테스트가 잡지 못하는 경우: Realtime 검사는 테스트 안의 테이블 목록(`items`, `lists`, `list_locations`)만 돌므로, 새 Realtime 테이블을 추가하면서 `applyChange`의 busy 가드를 빠뜨려도 그 목록에 테이블을 넣기 전에는 통과한다. 또 낙관적 쓰기의 쿼리 prefix가 `mk`의 엔티티 이름과 다르거나, `mk`에 없는 키로 큐 밖에서 낙관적 쓰기를 하는 경우다. 새 낙관적 쿼리는 prefix를 mutation 키의 엔티티 이름과 같게 짓는다.
- 새 낙관적 mutation은 `onSuccess`에서 무효화하지 않는다. 서버 값 맞추기는 `onSettled: invalidateWhenIdle`, 실패 복구는 `onError`에서만 한다.
- 근본적인 정리(소유자 하나, 방법 하나): 낙관적 prefix 목록이 세 곳(`invalidateWhenIdle`, `apply-change.ts`의 busy 분기, `BUSY_SKIP`)에 중복되어 있다. 이 목록을 `mk`에서 파생한 상수 하나로 모으면 이 종류의 실수가 구조적으로 사라진다. 제품 코드 변경이라 이번에는 하지 않았다.

## Related Issues
- `docs/superpowers/specs/2026-11-10-cart-note-design.md`와 `docs/superpowers/plans/2026-11-10-cart-note.md`의 Task 11은 Realtime이 항상 쓰거나 무효화한다고 적혀 있다. 이 learning 이전의 설계다.

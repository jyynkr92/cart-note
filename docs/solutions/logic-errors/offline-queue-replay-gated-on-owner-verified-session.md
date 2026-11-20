---
title: TanStack은 온라인이 되면 앱 순서를 기다리지 않고 큐를 재개한다 — onlineManager를 "네트워크·서버 연결·소유자 확인된 세션"으로 게이트한다
date: 2026-11-17
category: logic-errors
module: offline mutation queue (TanStack Query onlineManager, persisted mutations) + Supabase auth/RLS
problem_type: logic_error
component: frontend
symptoms:
  - 오프라인 로그인 상태에서 네트워크가 돌아오면 큐가 세션 없이 재생되어 수정·삭제·이동·비우기가 0행만 바꾸고 성공으로 끝남(쓰기가 조용히 사라짐)
  - 같은 상황에서 추가는 42501로 실패해 롤백됨
  - 앱 시작 시 디스크 캐시 소유자 확인보다 먼저 큐가 재개될 수 있음(다른 사용자의 큐가 재생될 위험)
  - 게이트를 넣은 뒤에는 소유자 확인 실패나 NetInfo는 연결인데 서버에 닿지 않는 경우 큐가 영원히 멈추거나 pending으로 재시도만 반복함
root_cause: async_timing
resolution_type: code_fix
severity: critical
tags: [tanstack-query, onlinemanager, resume-paused-mutations, offline-queue, session-gate, supabase-rls, anon-key, cache-owner, netinfo]
---

# TanStack은 온라인이 되면 앱 순서를 기다리지 않고 큐를 재개한다 — onlineManager를 "네트워크·서버 연결·소유자 확인된 세션"으로 게이트한다

## Problem
`QueryClient.mount()`는 `onlineManager`를 구독하고, 오프라인에서 온라인으로 바뀔 때마다 `resumePausedMutations()`를 부른다(`node_modules/@tanstack/query-core/src/queryClient.ts:113-118`, 5.107.1). 앱이 정한 순서(디스크 캐시 소유자 확인 → 세션 복구 → 재개)는 이 경로에 끼어들 수 없다. 세션 없이 재생된 요청은 supabase-js가 anon 키로 보내고, RLS 때문에 update/delete는 0행을 바꾸고 오류 없이 끝난다. 이 실수는 Task 7에서 처음 지적된 뒤 네 번의 리뷰를 거치며 점점 커졌다.

## Symptoms
- Task 7 리뷰 M1(Minor, 미뤄 둠): 앱 시작 시 온라인 전환 재개가 `CacheOwnerGuard`의 소유자 확인보다 먼저 일어날 수 있다. "onlineManager를 소유자 확인 전까지 게이트한다"가 처방이었지만 Minor로 미뤘다. (session history)
- 최종 리뷰 A8(gstack /review, Informational): 같은 지적이 `app/_layout.tsx`에서 다시 나왔다.
- gstack /review 3차 F2(CRITICAL): 오프라인 로그인 상태(토큰 만료, 갱신 실패)에서 네트워크가 돌아오면 큐가 `CacheOwnerGuard`를 거치지 않고 재생됐다. 요청은 anon으로 나가 수정·삭제·이동·비우기가 0행 성공으로 사라지고, 추가는 42501로 롤백됐다.
- F2 수정 후 재리뷰 I-1: 소유자 확인이 실패하면 게이트가 영원히 닫혀 모든 쿼리가 멈추고 빈 스피너만 남았다.
- 재리뷰 I-2: NetInfo는 연결이라는데 요청이 연결 오류로 실패하면 mutation이 `pending`으로 무한 재시도했다. `pending`은 영속화되지 않아 앱을 끄면 사라지고, 같은 scope의 큐 전체가 막혔다.
- 재리뷰 2 N-1: 소유자 기록 *쓰기* 실패를 읽기 실패처럼 다뤄 자기 큐를 지웠다.

## What Didn't Work
- **TanStack 문서의 React Native 예제 그대로 쓰기**(Task 7 원래 구현): `onlineManager.setEventListener(setOnline => NetInfo.addEventListener(s => setOnline(...)))`. 네트워크만 보고 온라인을 정하므로 세션·소유자 확인과 무관하게 재개된다.
- **소유자 가드 뒤에서 `resumePausedMutations()`를 직접 부르기**: 가드가 부르는 재개는 순서를 지키지만, `mount()`의 구독이 따로 재개하므로 아무것도 막지 못한다. 재개 경로는 하나가 아니다.
- **재시도 정책만으로 버티기**(F2 수정 때 버린 방안): `SessionUnavailableError`를 긴 지연으로 재시도하면 mutation이 `isPaused`가 아니라 `pending`에 머문다. 영속화 기본값은 `isPaused`인 mutation만 저장하므로(`hydration.ts:209-211`) 앱을 끄면 사라진다. I-2도 같은 원인이다.
- **요청 경계 확인 없이 게이트만 두기**: 게이트는 열려 있는데 토큰이 그사이 만료되고 갱신이 실패하면 `getSession()`이 null을 준다. 게이트 상태만으로는 이 순간을 알 수 없다.
- **소유자 확인이 실패하면 게이트를 닫아 두기**(F2 첫 수정): 안전해 보이지만 앱 전체가 멈춘다(I-1). 쿼리도 같은 `onlineManager`를 쓰기 때문이다.

## Solution
1. **onlineManager는 게이트 한 곳만 정한다**(`src/lib/session-gate.ts:31-33`): `onlineManager.setOnline((network ?? true) && reachable && ready)`.
   - `network`: NetInfo가 `setNetworkOnline`으로 넣는다. `setupOnlineManager`가 기본 window 리스너를 no-op으로 바꿔 게이트를 덮어쓰지 못하게 한다(`src/lib/query-client.ts:65-69`).
   - `ready`: `openSession(userId)`만 켠다(`session-gate.ts:149-156`). 부르는 곳은 `reconcileCacheOwner`가 소유자 확인을 끝낸 뒤 하나뿐이다(`src/auth/signed-out-state.ts:88-90`). `sessionRestored`는 확인된 같은 사용자일 때만 다시 켜고, 다른 사용자면 끈다(`session-gate.ts:172-175`).
   - `reachable`: 요청 도중 연결 오류(`RetryableNetworkError`)가 나면 `markBackendUnreachable()`이 끈다(`session-gate.ts:188-192`). 재탐지(5초부터 60초까지 백오프, NetInfo 복귀·앱 활성화 때 즉시)가 PostgREST에 닿는지 확인하고 다시 켠다.
2. **요청 경계에서 다시 확인한다**(`src/lib/mutation-utils.ts:23-39`). 모든 큐 mutation의 `mutationFn`은 `sessionGuarded`로 감싼다. 요청 직전에 `hasLiveSession()`(게이트를 연 사용자와 같은 사용자의 `getSession()`, `session-gate.ts:111-119`)이 아니면 게이트를 닫고 `SessionUnavailableError`를 던진다. 요청은 나가지 않는다.
3. **실패 대신 pause로 보낸다**(`src/lib/queue-retry.ts:20-27`). `SessionUnavailableError`와 `RetryableNetworkError`는 재시도 대상이고, 게이트가 닫혀 있으면 지연이 0이다. retryer가 곧바로 `onlineManager`를 보고 pause하므로(`retryer.ts:183-186`) mutation은 `isPaused`로 영속화되고 `onError`(롤백, 토스트)는 돌지 않는다. 게이트가 다시 열리면 TanStack이 정확히 한 번 재개한다.
4. **게이트가 영원히 닫히지 않게 한다.** 소유자 *읽기*는 짧게 재시도하고, 그래도 실패하면(소유자를 모름) 남의 것일 수 있는 캐시와 큐를 지운 뒤 게이트를 연다. 큐가 있었으면 "보내지 못한 변경을 지웠어요"를 한 번 알린다. 소유자 *쓰기* 실패는 무시한다. 같은 사용자면 쓰지도 않는다.
5. **화면은 게이트가 아니라 네트워크를 본다.** 쿼리도 같은 `onlineManager`로 멈추므로, 오프라인 배너는 게이트가 아는 네트워크 상태를 쓴다(`src/lib/use-online.ts:9-21`). 그러지 않으면 세션을 기다리는 동안 "오프라인"이 뜬다.

## Why This Works
TanStack 안에서 재개가 시작되는 길은 여럿이다. `mount()`의 online/focus 구독, 직접 부르는 `resumePausedMutations()`, 복원된 mutation의 `execute()`가 있다. 그러나 `networkMode`가 기본값 `'online'`이면 모두 결국 retryer의 `onlineManager.isOnline()` 확인을 지난다(`retryer.ts:96-100`, `:183-186`). 그래서 재개를 막는 길목은 `onlineManager` 값 하나다. 그 값을 "지금 이 사용자로 서버에 인증된 쓰기를 보낼 수 있다"로 정의하면 모든 재개 경로가 앱 순서를 따른다. 게이트가 열린 뒤 토큰이 만료되는 틈은 요청 경계의 확인이 막고, 그 실패를 pause로 보내 큐를 영속화된 채 남긴다.

## Prevention
- 계약 테스트 `__tests__/lib/session-gate-contract.test.ts`가 다음을 고정한다.
  - `onlineManager.setOnline`은 `session-gate.ts`에서만 부른다.
  - `setEventListener`는 no-op 형태만 허용한다. TanStack RN 예제처럼 NetInfo를 바로 연결하면 실패한다.
  - `networkMode`는 큐 밖(장소 검색)에서만 쓴다. `'always'`, `'offlineFirst'`는 `onlineManager`를 무시한다.
  - 모든 `mk` 키의 등록된 `mutationFn`은 세션이 없거나 다른 사용자의 세션이면 요청 없이 `SessionUnavailableError`를 던진다.
- 테스트가 잡지 못하는 것은 리뷰에서 묻는다.
  - "새 코드가 `openSession`을 소유자 확인 말고 다른 곳에서 부르는가?"
  - "큐 쓰기에서 새로 생길 수 있는 오류가 재시도(pause) 대상인가, 실패(롤백) 대상인가? 재시도라면 게이트를 닫아 `isPaused`가 되는가, 아니면 `pending`에 머무는가?"
  - "게이트를 닫는 새 경로에 다시 여는 길(재탐지, 대체 처리)이 있는가?"
- RLS 아래에서 anon 요청은 오류가 아니라 0행 성공으로 끝난다. "요청이 성공했다"를 "쓰기가 반영됐다"로 읽지 않는다. 인증이 확실하지 않은 쓰기는 보내지 않는 쪽으로 막는다.
- 리뷰에서 "재개가 앱 순서보다 먼저 일어날 수 있다"는 지적은 Minor로 미루지 않는다. 이 지적은 Task 7에서 Minor로 미뤄진 뒤 CRITICAL(F2)로 돌아왔다.

## Related Issues
- `docs/solutions/logic-errors/supabase-null-session-offline-is-not-signed-out.md`: 같은 상황(오프라인에서 `getSession()`이 null)의 다른 질문을 다룬다. 그 문서는 "로그인돼 있나"(저장된 세션으로 판단, 큐와 캐시를 지우지 않는다)이고, 이 문서는 "지금 인증된 쓰기를 보낼 수 있나"(게이트와 요청 경계 확인, 보내지 않고 멈춘다)이다.
- `docs/solutions/logic-errors/offline-queue-replay-must-carry-targets-and-reassert-intent.md`: 재생되는 요청의 *내용*이 안전해야 한다는 교훈. 이 문서는 재생의 *시점*과 *자격*을 다룬다. 연결 오류 후 mutation 전체를 다시 보내는 것(F7)은 그 문서의 멱등·조건 제한 덕분에 안전하다.
- `docs/solutions/logic-errors/offline-queue-optimistic-state-clobbered-by-mid-queue-refetch.md`: 같은 쓰기 큐.

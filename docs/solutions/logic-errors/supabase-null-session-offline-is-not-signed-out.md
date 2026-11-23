---
title: 오프라인에서 Supabase 세션이 null이어도 로그아웃이 아니다 — 로그인 여부는 저장된 세션이나 SIGNED_OUT으로 정한다
date: 2026-11-17
category: logic-errors
module: Supabase auth (supabase-js) + AuthProvider + geofence background task + cache owner guard
problem_type: logic_error
component: authentication
symptoms:
  - 오프라인 매장에서 지오펜스 알림이 오지 않음(캐시된 개수로 알려야 하는 바로 그 상황)
  - 오프라인 콜드 스타트에서 보내지 못한 오프라인 큐, 쿼리 캐시, 온보딩 표시, 지오펜스, 현재 그룹이 모두 지워짐
  - 모듈마다 "저장된 세션이 있다"의 기준이 달라 로그인 화면으로 가면서도 상태는 남음
root_cause: wrong_api
resolution_type: code_fix
severity: critical
tags: [supabase-auth, getsession, initial-session, signed-out, refresh-token, offline, headless, geofence, cache-owner]
---

# 오프라인에서 Supabase 세션이 null이어도 로그아웃이 아니다 — 로그인 여부는 저장된 세션이나 SIGNED_OUT으로 정한다

## Problem
supabase-js는 access token이 만료된 상태에서 갱신이 네트워크 오류(재시도 가능한 오류)로 실패하면 `getSession()`과 `INITIAL_SESSION`에 null 세션을 준다. 이때 저장소의 세션(refresh token)은 지우지 않는다. 그래서 null 세션은 "로그아웃"이 아니라 "로그인돼 있지만 지금은 오프라인"일 수 있다. 이 null을 로그아웃으로 쓴 코드가 세 번, 매번 다른 모듈에서 나왔다(세 번째는 그 판단 기준이 모듈마다 갈라진 경우).

## Symptoms
- Task 14 I1(리뷰 Important): 지오펜스 백그라운드 작업의 `hasSession`이 `supabase.auth.getSession()`으로 로그인 여부를 정했다. 오프라인이고 토큰이 만료됐으면 null이 와서 알림을 건너뛰었다. 캐시된 개수로 알리려고 만든 경로가 정확히 그 상황에서 꺼졌다.
- gstack /review 2차 B1(CRITICAL): 오프라인 콜드 스타트에서 auth-js가 `INITIAL_SESSION`을 null로 보냈고, `CacheOwnerGuard`가 `reconcileCacheOwner(null)`을 불러 오프라인 큐·쿼리 캐시·소유자 키·온보딩 표시·지오펜스·현재 그룹을 지웠다. 1차 리뷰에서 넣은 소유자 확인 가드가 만든 회귀였다.
- gstack /review 3차 F5(Informational): refresh token은 있는데 `user.id`가 없는 저장 세션을 한 모듈은 로그인으로, 다른 모듈은 로그아웃으로 봤다. 로그인 화면으로 가면서도 상태는 지우지 않았다.

## What Didn't Work
- **`getSession()`으로 로그인 여부 정하기**(Task 14 원래 구현): `getSession()`은 저장된 세션을 읽는 함수가 아니다. 만료된 토큰을 네트워크로 갱신하려 하고, 실패하면 null을 준다. 백그라운드·헤드리스 작업은 거의 항상 오프라인 가능성이 있는 곳에서 돈다. (session history)
- **Task 14를 고친 뒤에도 같은 가정이 다른 모듈로 들어감**: I1의 수정은 지오펜스 안에만 있었고, 교훈은 ledger의 "lesson candidate" 한 줄로만 남았다. 이후 리뷰 1차 수정(소유자 가드)이 `session?.user.id ?? null`을 그대로 "로그아웃"으로 받아 B1을 만들었다. 수정이 공유 헬퍼가 아니면 같은 실수가 다음 코드에서 다시 나온다. (session history)
- **저장 세션 판단을 모듈마다 따로 하기**: B1 수정 직후에는 지오펜스, `AuthProvider`, `reconcileCacheOwner`가 각자 조금 다른 조건(refresh token만, 또는 user id까지)을 봤다. F5가 그 틈이다.

## Solution
1. **저장된 세션을 네트워크 없이 읽는 헬퍼 하나**(`src/auth/stored-session.ts:12-31`). `AUTH_STORAGE_KEY`로 AsyncStorage를 직접 읽고, refresh token이 비어 있지 않고 `user.id`가 uuid 형태일 때만 `{ userId }`를 돌려준다(`:20-22`). 절대 던지지 않는다. 이 키는 클라이언트 내부 필드가 아니라 명시적 상수로 고정했다(`src/lib/supabase.ts:10`, `:18`). `__tests__/lib/supabase-config.test.ts`가 클라이언트가 같은 키로 저장하는지 고정한다.
2. **로그아웃은 실제 `SIGNED_OUT`이나 저장 세션 없음으로만 정한다.** `AuthProvider`의 `onAuthStateChange`는 `SIGNED_OUT`에서만 캐시와 기기 상태를 지운다(`src/auth/AuthProvider.tsx:57-64`). 그 밖의 이벤트에서 세션이 null이면 저장된 세션을 읽고 그 사용자 id를 `offlineUserId`로 내놓는다(`:72-78`). 늦게 끝난 저장소 읽기가 더 최근 이벤트를 덮어쓰지 않게 이벤트 순번을 확인한다.
3. **모든 소비자가 같은 기준을 쓴다.**
   - 지오펜스: `const hasSession = hasStoredSession`(`src/geofence/geofence-task.ts:19`).
   - 소유자 가드: `reconcileCacheOwner(client, null)`은 저장 세션이 있으면 게이트만 닫고 아무것도 지우지 않는다(`src/auth/signed-out-state.ts:66-67`). 세션이 돌아오면 사용자 id로 다시 불려 소유자 확인 뒤 큐를 재개한다.
   - 라우팅과 화면: `!session && !offlineUserId`일 때만 `/login`으로 보낸다(`app/(app)/_layout.tsx:31`, `app/(auth)/_layout.tsx:7`). 사용자 id가 필요한 화면은 `session?.user.id ?? offlineUserId`를 쓴다(`app/(app)/index.tsx:33`, `app/(app)/settings.tsx:38`).

## Why This Works
auth-js는 재시도 가능한 갱신 실패에서는 저장된 세션을 그대로 두고, 세션이 정말 끝났을 때(access token이 이미 만료된 상태에서 갱신 토큰 거부, 로그아웃)는 저장소에서 지운 뒤 `SIGNED_OUT`을 보낸다(이 세션의 리뷰 결론. 설치된 `@supabase/auth-js` 2.119.0의 `GoTrueClient` 복구 경로에도 재시도 가능한 오류에서는 "the session is untouched"라고 적혀 있다). 그래서 "저장소에 유효한 refresh token이 있다"가 "로그인돼 있다"의 네트워크 없는 정확한 대리 지표가 되고, `SIGNED_OUT`은 진짜 로그아웃만 알린다. 판단 기준이 헬퍼 하나에 있어 모듈마다 어긋나지 않는다.

## Prevention
- 계약 테스트 `__tests__/auth/auth-state-source-contract.test.ts`가 `getSession()`과 `onAuthStateChange`를 부르는 파일을 이유와 함께 목록으로 고정한다. Task 14처럼 새 코드가 `getSession()`으로 로그인 여부를 정하면 목록 밖 호출 파일을 이름으로 보여 주며 실패한다. 목록에 넣으려면 그 호출이 null을 로그아웃으로 쓰지 않는다는 이유를 적어야 한다.
- 테스트가 잡지 못하는 것: `useAuth()`의 `session`을 받아 null을 로그아웃으로 쓰는 코드(B1의 모양)는 `getSession()`을 부르지 않는다. 리뷰에서 이렇게 묻는다. "이 코드가 세션 없음일 때 지우거나, 로그인으로 보내거나, 알림을 끄는가? 그렇다면 `offlineUserId`(또는 `hasStoredSession`)를 보는가, 아니면 `SIGNED_OUT`에서만 하는가?"
- 헤드리스·백그라운드 코드(지오펜스 작업 등)는 네트워크 갱신이 필요한 API로 로그인 여부를 정하지 않는다. 메모리의 QueryClient도, 갱신된 토큰도 없다고 가정한다.
- **`getSession()`이 맞는 곳은 따로 있다**: 큐 요청을 보내기 직전의 확인(`src/auth/session-check.ts:8-15`)은 실제로 쓸 수 있는 토큰이 필요하다. 여기서 null은 "지금 보내지 마라"(anon으로 나가면 RLS가 0행을 바꾸고 성공처럼 보인다)이고, 로그아웃 판단이 아니다. 두 질문(로그인돼 있나 / 지금 서버에 인증된 요청을 보낼 수 있나)을 섞지 않는다.
- `SIGNED_OUT`에서 지우는 것도 조심한다. 콜드 스타트에서 만료된 토큰의 갱신이 거부되면 사용자가 누르지 않아도 `SIGNED_OUT`이 온다. 사용자가 직접 로그아웃할 때만 지워야 하는 것(받아 둔 초대 링크)은 로그아웃 버튼 쪽에서 지운다(`app/(app)/settings.tsx:178-181`).

## Related Issues
- `docs/solutions/logic-errors/offline-queue-optimistic-state-clobbered-by-mid-queue-refetch.md`, `docs/solutions/logic-errors/offline-queue-replay-must-carry-targets-and-reassert-intent.md`: 같은 오프라인 큐를 다룬다. 이 문서는 큐가 인증 쪽 오판으로 통째로 지워지는 경로를 다룬다.

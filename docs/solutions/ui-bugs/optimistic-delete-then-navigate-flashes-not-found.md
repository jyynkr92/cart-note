---
title: 낙관적 삭제·나가기 뒤 router.replace 사이에 화면이 "찾을 수 없어요"를 비치는 문제
date: 2026-11-17
category: ui-bugs
module: Expo Router 화면 + TanStack Query 낙관적 mutation (목록 상세, 설정)
problem_type: ui_bug
component: frontend
symptoms:
  - 목록 삭제를 확인하면 홈으로 가기 전에 상세 화면에 "목록을 찾을 수 없어요"가 잠깐 보임
  - 삭제 직후 지워진 목록의 items 쿼리가 한 번 더 조회됨
  - 그룹을 나가면 홈으로 가기 전에 설정 화면에 남은 다른 그룹이나 빈 화면이 잠깐 보임
root_cause: async_timing
resolution_type: code_fix
severity: medium
tags: [expo-router, router-replace, optimistic-update, tanstack-query, flash, leaving-state, deleting-state]
---

# 낙관적 삭제·나가기 뒤 router.replace 사이에 화면이 "찾을 수 없어요"를 비치는 문제

## Problem
화면이 보고 있는 데이터를 지우는 동작(목록 삭제, 그룹 나가기)을 실행하고 곧바로 `router.replace('/')`를 부르면, 이동이 끝날 때까지 그 화면은 마운트된 채 남는다. 그사이 캐시가 비면서 화면이 "없음"/다른 데이터 상태로 다시 그려져 사용자에게 깜빡인다. 같은 모양이 Task 9(목록 삭제)와 Task 12(그룹 나가기)에서 두 번 나왔다.

## Symptoms
- Task 9 리뷰 I1: `app/(app)/list/[id]/index.tsx`의 `confirmDelete`가 `deleteList.mutate` 뒤 `router.replace('/')`를 불렀다. 낙관적 `apply`가 `qk.lists(familyId)` 캐시에서 목록을 빼는 순간(`src/lists/use-lists.ts:97`) 화면의 `!list` 분기가 "목록을 찾을 수 없어요"를 그렸다. 리뷰는 삭제 직후 items 재조회도 함께 지적했고, 수정 라운드의 테스트가 이를 회귀로 고정한다(재조회 경로 자체는 이 문서에서 확인하지 못했다).
- Task 12 그룹 나가기: 나간 뒤 `families`/onboarding을 다시 조회하는 동안 설정 화면이 남은 그룹(다른 초대 코드)이나 빈 화면을 비칠 수 있었다. 구현 때부터 `leaving` 로딩 화면으로 막았다.

## What Didn't Work
- **mutate 다음에 바로 `router.replace`를 부르면 충분하다고 보기**: 낙관적 캐시 변경은 `onMutate`에서 `cancelQueries`를 기다린 직후 반영된다(`src/lists/use-lists.ts:48-52`). 화면 전환은 그보다 늦게 끝나 이전 화면을 언마운트한다. 둘 사이에 최소 한 번은 빈 캐시로 렌더된다. (session history)
- **가드를 세우고 해제 경로를 두지 않기**: 최종 리뷰 C1에서 마지막 그룹을 나가면 다음 그룹이 없어 설정 화면이 `leaving` 스피너에 영원히 머물렀다. onboarding 재조회(남은 그룹이 없으면 개인 그룹 생성)와 families 재조회를 함께 기다린 뒤, 실패가 아니면 항상 홈으로 보내도록 고쳤고(`app/(app)/settings.tsx:152-166`), 그 재조회가 실패하면(R2) 토스트를 띄우고 `leaving`을 풀어 화면에 머문다(`app/(app)/settings.tsx:159-163`). 깜빡임을 막는 가드가 해제 경로 없이 있으면 영구 스피너로 바뀐다. (session history)
- 리뷰 브리프가 제시한 다른 선택지, **먼저 이동하고 그다음 mutate**는 쓰지 않았다. 가드 상태 쪽이 테스트로 고정하기 쉽고 두 화면에 같은 모양으로 적용된다.

## Solution
지우는 동작을 시작하기 전에 화면 로컬 상태(`deleting` / `leaving`)를 세우고, 그 상태면 다른 모든 렌더 분기보다 먼저 스피너를 돌려준다.

```tsx
// app/(app)/list/[id]/index.tsx
const [deleting, setDeleting] = useState(false);
...
if (deleting) return <Spinner />;          // not-found, 오프라인, 오류 분기보다 앞
...
function confirmDelete() {
  if (!familyId) return;
  setDeleting(true);                        // mutate보다 먼저
  deleteList.mutate({ id: listId, familyId });
  setMode(null);
  goHome();                                 // router.replace('/')
}
```

설정의 `leave()`(`app/(app)/settings.tsx:136-167`)는 서버 호출 `leaveFamily`가 낙관적이지 않아 실패하면 화면이 그대로여야 하므로, 그 `await`이 성공한 뒤, 하지만 캐시를 건드리는 `setFamilyId`·invalidate보다 먼저 `setLeaving(true)`를 세운다. 기준은 "네트워크 호출 전"이 아니라 **"화면이 읽는 캐시나 상태가 처음 바뀌기 전"**이다. 재조회 실패로 이동하지 않을 때는 `setLeaving(false)`로 되돌린다.

회귀 테스트:
- `__tests__/list-detail.test.tsx` "does not flash the not-found state while deleting, nor refetch items"
- `__tests__/settings.test.tsx` "does not flash another group or an empty screen while leaving", "goes home after leaving the last group…", "reports the failure and stays instead of going to a blank home"

## Why This Works
`router.replace`는 다음 화면으로 전환을 시작할 뿐 현재 화면을 동기적으로 없애지 않는다. 그래서 현재 화면은 자기 데이터를 지운 캐시로 한 번 이상 다시 렌더된다. 가드 상태를 mutate보다 먼저 세우므로(`app/(app)/list/[id]/index.tsx:185-186`), 비동기로 오는 캐시 변경이 렌더될 때는 이미 맨 앞의 스피너 분기가 걸려 not-found/다른 그룹 분기에 닿지 않는다. 가드는 렌더 분기만 막을 뿐 훅을 떼지 않는다. `useItems(list?.id)`는 가드보다 위에서 계속 호출되며, 목록이 캐시에서 빠지면 `enabled: !!listId`로 비활성화된다(`src/items/use-items.ts:17-19`). items 재조회가 없다는 테스트 단언은 이 동작을 고정한다.

## Prevention
- 화면이 보여 주는 엔티티를 지우거나 그 엔티티에서 빠지는 동작(삭제, 나가기, 그룹 전환 뒤 이동 등)을 새로 만들 때는 `router.replace`/`back` 앞에 가드 상태를 세우고, 그 분기를 렌더 함수의 맨 앞에 둔다.
- 가드는 첫 캐시·상태 변경보다 먼저 세우고, 이동하지 않고 머무는 모든 경로(실패, 다음 목적지 없음)에서 푼다. 이동이 항상 일어나는 경로(목록 삭제는 `goHome()`을 무조건 부른다)라면 풀 필요가 없다. 목록 삭제의 `deleting`은 그래서 리셋하지 않기로 했다(최종 수정에서 accepted).
- 테스트는 "확인 → 이동 호출" 뿐 아니라 "그사이 not-found/다른 데이터 텍스트가 보이지 않음"과 "지운 엔티티의 쿼리를 다시 조회하지 않음"을 단언한다. 서버 mock은 삭제 이후 조회에서 그 엔티티를 돌려주지 않게 바꿔 두어야 깜빡임이 재현된다.

## Related Issues
- [오프라인 큐가 비기 전에 재조회·Realtime 쓰기가 낙관적 값을 덮는 문제](../logic-errors/offline-queue-optimistic-state-clobbered-by-mid-queue-refetch.md) — 같은 낙관적 캐시 기계를 다루지만 원인(큐 중간 재조회)이 다르다.

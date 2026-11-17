---
title: 오프라인 큐 재생이 엉뚱한 항목을 지우거나 옮기는 문제 — 대상은 변수에 담고, 서버 문장은 누를 때의 조건을 다시 확인한다
date: 2026-11-17
category: logic-errors
module: offline mutation queue (TanStack Query persisted mutations) + Supabase items
problem_type: logic_error
component: frontend
symptoms:
  - 오프라인에서 완료 항목 지우기/목록 비우기를 누른 뒤 재생되면, 그사이 다른 가족이 넣은 항목까지 지워짐
  - 누를 때 보이던 id로만 지우도록 고친 뒤에도, 그사이 다른 사람이 미완료로 되돌리거나 다른 목록으로 옮긴 항목이 지워짐
  - 이동을 재생하면 그사이 다른 사람이 다른 목록으로 옮긴 항목을 다시 끌어옴
root_cause: concurrency
resolution_type: code_fix
severity: critical
tags: [offline-queue, mutation-replay, persisted-variables, tanstack-query, supabase, intent-guard, clear-done, move-items]
---

# 오프라인 큐 재생이 엉뚱한 항목을 지우거나 옮기는 문제 — 대상은 변수에 담고, 서버 문장은 누를 때의 조건을 다시 확인한다

## Problem
큐 mutation은 누른 순간이 아니라 나중에 재생된다(앱을 다시 켠 뒤, 온라인이 된 뒤). 그 사이 다른 가족 구성원이 같은 그룹의 항목을 바꿀 수 있다. 재생할 때 대상을 다시 고르거나(서버의 `list_id` 조건, 그 시점의 캐시), 대상을 id로만 집고 사용자가 본 조건을 확인하지 않으면, 사용자가 보지도 않은 행을 지우거나 옮긴다. 같은 실수가 세 번, 매번 다른 반쪽으로 나왔다.

## Symptoms
- A2(gstack /review 1차, CRITICAL): `clearDoneItems`/`clearListItems`가 재생 시점에 `list_id`(완료 지우기는 `is_done`도)로 지웠다. 오프라인에서 비우기를 누른 뒤 큐가 비기 전에 다른 사람이 넣은 항목까지 지워졌다.
- B2(gstack /review 2차, CRITICAL): A2를 고치려고 누를 때의 id로만 지우게 하자, 그사이 다른 사람이 미완료로 되돌리거나 다른 목록으로 옮긴 항목이 지워졌다. A2 수정이 만든 회귀였다.
- M-5(post-review): 이동 재생이 id로만 `list_id`를 바꿔서, 그사이 다른 사람이 다른 목록으로 옮긴 항목을 다시 끌어왔다. `MoveVars`에는 처음부터 `fromListId`가 있었지만 서버 문장이 쓰지 않았다.

## What Didn't Work
- **재생 시점에 서버 조건으로 대상 고르기**(`delete … where list_id = ?`): 원래 설계였다. 큐는 순서는 지키지만 시점은 지키지 않는다. 재생 때의 "그 목록의 모든 항목"은 사용자가 본 집합이 아니다. (session history)
- **id만 담고 서버에서 조건을 다시 확인하지 않기**: A2를 고친 1차 수정이다. 대상을 고정하는 것만으로는 부족했다. 사용자가 누른 이유(그 목록에 있다, 완료 상태다)가 재생 때도 참인지 서버가 확인하지 않으면, 상태가 바뀐 행을 그대로 지운다. 한쪽만 고쳐서 CRITICAL 회귀가 생겼다. (session history)
- **변수에는 있는데 서버 문장에서 쓰지 않기**: M-5. `fromListId`는 낙관적 반영에만 쓰이고 `moveItems`에 넘어가지 않았다. 변수에 담는 것과 서버가 확인하는 것은 따로 챙겨야 한다.

## Solution
두 가지를 함께 한다. 하나만 하면 위의 반쪽 실수가 된다.

1. **대상은 누를 때 변수에 담는다.** 영속화된 변수가 재생에 필요한 것을 모두 가진다. `useClearDone`/`useClearList`는 `withPrepare`에서 그 순간 캐시에 보이는 id(완료 항목, 또는 목록의 모든 항목)를 `ClearVars = { listId, ids }`에 담는다(`src/items/use-items.ts:29-30`, `:239-255`). 이동은 `MoveVars = { fromListId, toListId, ids }`(`:28`). mutationFn은 변수만 읽고 캐시에서 다시 고르지 않는다. 보이는 항목이 없으면 prepare가 null을 돌려 mutation을 만들지 않는다.
2. **서버 문장은 누를 때의 조건을 다시 확인한다.** 담은 id에 사용자가 본 상태를 조건으로 붙인다. 조건이 깨진 행은 건드리지 않고 남긴다(`src/items/item-api.ts`).
   - 완료 지우기: `delete().in('id', batch).eq('list_id', listId).eq('is_done', true)` (`:72-76`)
   - 목록 비우기: `delete().in('id', batch).eq('list_id', listId)` (`:79-83`)
   - 이동: `update({ list_id: toListId }).in('id', batch).eq('list_id', fromListId)` (`:89-93`)
덧붙여:
- 낙관적 반영도 같은 범위만 바꾼다. 비우기의 `removeIds`는 변수의 id만 캐시에서 뺀다(`use-items.ts:48-52`).
- id를 담으면 필터 길이가 정해지지 않으므로 `.in('id', …)`은 100개씩 나눠 보낸다(`ID_BATCH_SIZE`, `item-api.ts:49-62`).
- 이전 버전이 영속화한 변수: id가 없는 비우기는 아무것도 지우지 않는다(`run`이 `v.ids ?? []`, `use-items.ts:165`, `:173`). `fromListId`가 없는 이동은 예전처럼 id로만 옮긴다(`item-api.ts:92`).

## Why This Works
재생되는 요청이 "사용자가 본 것" 안에서만 움직인다. 변수의 id가 대상의 상한을 정하고, 서버 조건이 그중 지금도 사용자가 본 상태 그대로인 행만 남긴다. 그사이 다른 사람이 넣은 행은 id 목록에 없고, 상태를 바꾼 행은 조건에 걸러진다. 두 조건이 묶음마다 서버 문장 하나 안에 함께 있어서, 확인과 쓰기 사이에 다른 쓰기가 끼어들 틈이 없다. 걸러진 행은 큐가 비면 `invalidateWhenIdle`의 재조회가 화면을 서버 값으로 되돌린다(`docs/solutions/logic-errors/offline-queue-optimistic-state-clobbered-by-mid-queue-refetch.md`).

## Prevention
- 계약 테스트 `__tests__/lib/queue-replay-contract.test.ts`가 반쪽 하나를 붙잡는다. `mk`의 모든 큐 mutation에 대해 등록된 mutationFn을 영속화된 변수 샘플로 실행하고 (1) 재생 시점 캐시가 비었을 때와 남이 넣은 항목이 섞였을 때 나가는 요청이 같은지(대상을 캐시에서 다시 고르지 않는지), (2) 모든 update/delete가 `eq('id')`나 `in('id')`로 행 id 범위 안에 있는지 확인한다. A2처럼 `list_id`만으로 지우면 "not scoped by row id"로 실패한다. 새 `mk` 키에 샘플 변수를 넣지 않아도 실패한다.
- 테스트가 잡지 못하는 반쪽: 서버 문장이 **누를 때의 조건을 다시 확인하는지**는 mutation마다 의미가 달라 일반 테스트로 붙잡을 수 없다(B2, M-5). 새 큐 mutation이나 기존 mutation의 변경을 리뷰할 때 이렇게 묻는다. "누를 때 사용자가 본 것 중 재생 전에 다른 사람이 바꿀 수 있는 것은 무엇인가? 그 조건이 변수에 있고, 서버 문장의 필터에 있는가?" 변수에 있는 값(`fromListId`처럼)이 서버 문장에서 쓰이지 않으면 의심한다.
- 의도적으로 조건을 붙이지 않은 곳: `deleteItems`(골라서 삭제)와 `updateItem`/토글은 id로만 쓴다. 사용자가 그 행 자체를 골랐으므로 그사이 옮겨졌어도 같은 행이고, 마지막 쓰기 우선으로 받아들였다. 이 판단을 바꾸면 같은 방식으로 조건을 추가한다.
- 조건을 추가할 때 그 컬럼이 RLS/컬럼 권한으로 필터에 쓸 수 있는지, 그리고 조건 때문에 0행이 바뀌는 경우가 오류가 아니라 정상으로 처리되는지 확인한다(앱의 `check`는 응답의 `error`만 보므로 0행이 바뀐 결과는 성공으로 처리된다, `item-api.ts:13-15`).

## Related Issues
- `docs/solutions/logic-errors/offline-queue-optimistic-state-clobbered-by-mid-queue-refetch.md`: 같은 큐에서 낙관적 값과 서버 값 맞추기(무효화 시점)를 다룬다. 이 문서는 재생되는 요청이 무엇을 건드리는지를 다룬다.

---
title: "끄는 도중 목록 데이터가 바뀌면 react-native-reorderable-list가 다른 항목을 옮긴다"
date: 2026-11-25
category: ui-bugs
module: app/(app)/index.tsx (홈 목록 끌어서 순서 바꾸기) + react-native-reorderable-list 0.18.x
problem_type: ui_bug
component: frontend
symptoms:
  - "끄는 사이 다른 가족이 순서를 바꾸거나 목록을 만들고 지우면, 놓은 뒤 사용자가 집지 않은 목록이 옮겨져 저장된다"
  - "화면에서 들려 있는 카드와 저장되는 카드가 다르다"
  - "Jest 목은 onReorder를 바로 부르므로 테스트로는 보이지 않는다"
root_cause: async_timing
resolution_type: code_fix
severity: medium
tags: [react-native-reorderable-list, drag-and-drop, realtime, refetch, reanimated, worklet, index-space]
---

# 끄는 도중 목록 데이터가 바뀌면 react-native-reorderable-list가 다른 항목을 옮긴다

## Problem
홈 목록은 Realtime 재조회로 `data`가 바뀔 수 있다. 끄는 도중에 바뀌면 놓을 때 받는 `{ from, to }`가 서로 다른 순서를 가리켜, 사용자가 집은 목록이 아닌 다른 목록이 옮겨져 저장된다.

## Root cause
라이브러리 소스(0.18.3)를 읽어 확인한 동작:
- `from`(집은 자리)은 끌기를 시작할 때 한 번 정해진다.
- `to`(놓은 자리)는 끄는 동안 **지금의** `data` 기준 셀 위치·크기로 계산된다.
- 들려 보이는 셀도 지금의 `data`에서 `from` 자리에 있는 셀이다.
- 제자리에 놓으면(`from === to`) `onReorder`는 오지 않는다. `onDragEnd`는 놓는 즉시 오고, `onReorder`는 놓는 애니메이션이 끝난 뒤에 온다.
- 앞선 놓기 애니메이션 중에는 길게 눌러도 새 끌기가 시작되지 않는다.

그래서 `data`가 끄는 중에 바뀌면 `from`과 `to`가 다른 순서 기준이 된다.

## Solution
끄는 동안 `ReorderableList`에 넘기는 `data`를 집은 순간의 목록으로 고정한다.
- `onDragStart`에서 고정한다. 이 콜백은 Reanimated worklet이어야 하므로 `scheduleOnRN`(react-native-worklets)으로 JS 함수를 부른다. 실제로 끌기가 시작될 때만 오므로 길게 누르기(`onLongPress`)에서 잡는 것보다 정확하다.
- `onReorder`에서 고정한 목록에 `from`·`to`를 적용해 저장하고 푼다.
- `onDragEnd`에서는 `from === to`일 때만 푼다. 자리를 옮겼을 때 여기서 풀면, 뒤따르는 `onReorder`보다 먼저 `data`가 바뀐다.

고정한 순서를 저장해도 안전한 이유: `reorder_lists` RPC와 낙관적 반영 모두 그사이 지워진 id는 건너뛰고, 새로 생긴 목록은 뒤에 붙인다.

## 통과하지 못한 시도
같은 브랜치의 리뷰에서 차례로 걸렸다.
1. `from`·`to`가 목록 길이 안에 있는지만 확인: 목록 수가 같은 변경(다른 사람의 순서 바꾸기)은 못 막는다.
2. 길게 누를 때 id 순서를 저장해 두고 거기에 적용: `from`만 맞고 `to`는 여전히 새 순서 기준이다. 또 끌기가 거부된 길게 누르기에서도 저장된다.

## Prevention
- `react-native-reorderable-list`로 다른 목록(예: 목록 안 항목 순서 바꾸기)을 만들 때, 데이터가 바깥(재조회·Realtime·다른 mutation)에서 바뀔 수 있으면 같은 방식으로 끄는 동안 `data`를 고정한다.
- Jest 목(`test-utils/reorderable-list.tsx`)은 길게 누를 때 `onDragStart`, 놓을 때 `onDragEnd` 다음 (자리가 바뀌었으면) `onReorder` 순서를 흉내 낸다. 끄는 중 재조회 테스트는 이 순서에 기대므로, 목을 고칠 때 순서를 지킨다. 제스처와 실제 자리 계산은 목이 재현하지 못하므로 iOS 시뮬레이터에서 끌기와 제자리 놓기를 직접 해 본다.

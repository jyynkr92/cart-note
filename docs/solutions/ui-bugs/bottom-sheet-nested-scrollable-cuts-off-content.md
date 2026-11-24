---
title: "@gorhom/bottom-sheet에서 BottomSheetView 안에 BottomSheetScrollView를 넣으면 시트 높이가 잘린다"
date: 2026-11-24
category: ui-bugs
module: components/ui/sheet.tsx (Sheet, MenuSheet, MoveSheet) + @gorhom/bottom-sheet 5.2.14
problem_type: ui_bug
component: frontend
symptoms:
  - "⋯ 메뉴 시트가 너무 낮게 열려 마지막 항목이 홈 인디케이터에 걸리고 취소 버튼이 화면 밖으로 나감"
  - "Jest 테스트는 모두 통과하는데 시뮬레이터에서만 보임"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags: [gorhom-bottom-sheet, dynamic-sizing, bottom-sheet-scrollview, contentheight, jest-mock, expo-go]
---

# @gorhom/bottom-sheet에서 BottomSheetView 안에 BottomSheetScrollView를 넣으면 시트 높이가 잘린다

## Problem
긴 목록을 스크롤되게 하려고 `Sheet`(dynamic sizing, `BottomSheetView`) 안의 항목 영역만 `BottomSheetScrollView`로 감쌌더니, 항목이 3개뿐인 ⋯ 메뉴도 목록 높이만큼만 열렸다. 그 아래에 있던 취소 버튼과 safe-area 여백이 화면 밖으로 밀렸다.

## Root cause
dynamic sizing에서 시트 높이는 `animatedLayoutState.contentHeight` 하나로 정해지는데, 이 값을 쓰는 곳이 둘이 됐다.

- `BottomSheetView`의 onLayout이 전체 내용 높이(제목, 목록, 취소 버튼, 하단 여백)를 쓴다 (`node_modules/@gorhom/bottom-sheet/src/components/bottomSheetView/BottomSheetView.tsx` 44-57행).
- 안쪽 `BottomSheetScrollView`도 onContentSizeChange에서 자기 행 높이만 다시 쓴다 (`createBottomSheetScrollableComponent.tsx` 101-107행, `useBottomSheetContentSizeSetter.ts` 14-24행).

나중에 쓴 쪽이 이긴다. 그래서 시트가 목록 높이로만 잡혔다(`useAnimatedDetents.ts` 76-86행). 또 바깥 `BottomSheetView`가 스크롤 종류를 VIEW로 다시 등록해 스크롤과 끌기 판정까지 바뀐다.

Jest 목은 `BottomSheetScrollView`를 평범한 `ScrollView`로 바꾸고 높이를 재지 않는다. 그래서 테스트로는 보이지 않았고, 시뮬레이터 스크린샷으로만 잡혔다.

## Solution
시트 하나에는 내용 컨테이너를 하나만 둔다. 목록처럼 길어질 수 있는 시트는 `<Sheet scrollable>`을 쓴다. 이때는 `BottomSheetScrollView`가 시트 내용 전체가 되어 높이를 혼자 잰다. 나머지 시트는 그대로 `BottomSheetView`를 쓴다. 최대 높이(화면의 80%, `maxDynamicContentSize`)는 scrollable 시트에만 둔다. 이 방식에서는 메뉴의 취소 버튼도 스크롤 내용의 마지막 행이 된다.

## Prevention
- `eslint.config.js`의 `no-restricted-imports`가 `components/ui/sheet.tsx` 밖에서 `@gorhom/bottom-sheet`의 `BottomSheetView`·`BottomSheetScrollView`·`BottomSheetFlatList` 같은 내용 컨테이너를 import하면 오류를 낸다. 화면은 시트 안에 스크롤 영역을 따로 만들지 말고 `<Sheet scrollable>`을 고른다.
- 시트 크기·제스처·키보드는 목이 재현하지 못한다. 이런 변경은 Expo Go 시뮬레이터에서 짧은 메뉴(취소까지 보이는지)와 긴 목록(스크롤되는지)을 직접 열어 본다.

---
title: "bottom sheet가 닫히는 동안 닫는 렌더의 내용이 그대로 보이고 눌린다"
date: 2026-11-24
category: ui-bugs
module: components/ui/sheet.tsx (Sheet, ConfirmSheet, useLastWhileOpen) + 시트를 쓰는 화면
problem_type: ui_bug
component: frontend
symptoms:
  - "항목 편집을 저장하면 시트가 빈 채로 줄어들며 내려감"
  - "선택 항목 삭제를 확인하면 '0개 항목을 삭제할까요?'가 보이며 내려감"
  - "그룹 이름을 바꾸면 내려가는 동안 제목이 '새 그룹'으로 바뀜"
  - "닫히는 중에 한 번 더 누르면 목록이 두 개 만들어지거나 취소 뒤에 삭제가 실행됨"
root_cause: async_timing
resolution_type: code_fix
severity: medium
tags: [gorhom-bottom-sheet, close-animation, portal, uselastwhileopen, double-tap, jest-mock]
---

# bottom sheet가 닫히는 동안 닫는 렌더의 내용이 그대로 보이고 눌린다

## Problem
@gorhom/bottom-sheet 시트는 닫는 애니메이션(약 250ms) 동안 화면에 남아 있고, 그동안 터치도 받는다. 예전 가운데 Dialog는 닫는 즉시 사라졌으므로 같은 코드에서 문제 두 가지가 새로 생겼다.

## Root cause
1. **닫는 렌더의 내용이 그대로 남는다.** 화면이 시트를 닫는 같은 렌더에서 내용의 근거를 지우는 경우가 있다(`item=null`, `selection.clear()`, `mode=null`). 그런데 Portal 업데이트 effect가 `dismiss()`보다 먼저 돌아서 상태가 아직 PRESENTED일 때 바뀐 내용이 들어간다. 그 뒤 라이브러리는 DISMISSING 동안 내용 갱신을 멈춘다. 그래서 바뀐 내용이 내려가는 내내 보인다.
2. **사용자 닫기 중에는 `open`이 아직 true다.** 배경 탭이나 끌어 닫기로 닫으면 `onDismiss`가 올 때까지 부모의 `open`은 true다. 그래서 `open`만 보고 터치를 막으면 내려가는 중에 버튼이 다시 눌린다.

Jest 목은 처음에 둘 다 재현하지 못했다. 닫으면 내용을 바로 지웠고, 닫기 시작 신호도 없었다. 그래서 테스트가 통과한 상태로 실기기 리뷰에서 발견됐다.

## Solution
- **시트 쪽:** `Sheet`가 두 번째 문제를 혼자 처리한다. 화면이 할 일은 없다. 내용의 `pointerEvents`를 `open && !closing`으로 둔다. `closing`은 `onAnimate(toIndex === -1)`에서 켜고, 제자리로 돌아오거나(`toIndex >= 0`) `onDismiss`가 오면 끈다. `ConfirmSheet`는 한 번 열릴 때 확인이나 취소 중 하나만 받는다.
- **화면 쪽:** 첫 번째 문제는 화면이 직접 막아야 한다. 닫을 때 바뀌는 값을 시트 내용에 쓰려면 `useLastWhileOpen(value, open)`으로 감싼다. 열려 있는 동안은 실제 값을 따르고, 닫히는 렌더부터는 마지막으로 열려 있던 때의 값을 보여 준다. 지금은 `ItemEditSheet`(편집 대상), 목록 상세의 선택 삭제 개수, `GroupNameSheet`(모드)가 쓴다.
- **테스트:** 목은 이제 `holdSheetDismissals()` 중에 `dismiss()` 때의 내용을 고정하고, 사용자 닫기 때 `onAnimate`를 보낸다. 새 화면은 "닫기를 붙잡은 상태에서 닫기 전 내용이 보인다"는 테스트로 고정한다.

## Prevention
새 시트를 만들 때, 닫는 렌더에서 바뀌는 상태(대상 null, 선택 비우기, 모드 리셋)를 시트 제목이나 내용에 쓰고 있다면 `useLastWhileOpen`으로 감싼다. 시트 크기·제스처·닫는 애니메이션은 목이 일부만 흉내 내므로 Expo Go 시뮬레이터에서 닫는 순간을 직접 본다.

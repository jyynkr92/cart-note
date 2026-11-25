---
title: "bottom sheet 안의 제어 입력 칸에서 iOS 한글 조합이 풀린다"
date: 2026-11-25
category: ui-bugs
module: components/ui/sheet.tsx (SheetInput) + 시트 안에 입력 칸을 두는 화면
problem_type: ui_bug
component: frontend
symptoms:
  - "시트 입력 칸에 '하이'를 치면 'ㅎㅏㅇㅣ'처럼 자모가 풀려 들어가고 추천 단어가 안 뜬다"
  - "처음 고친 뒤에는 글자가 중간에 빠진다('하이' → 'ㅎㅇ')"
  - "Jest 테스트와 리뷰는 모두 통과하는데 iOS 시뮬레이터에서만 보인다"
root_cause: async_timing
resolution_type: code_fix
severity: high
retire_when: "@gorhom/bottom-sheet 또는 React Native가 포털 안 제어 TextInput의 IME 조합을 고쳤다고 알릴 때. 새 Expo 앱의 BottomSheetModal에 value를 넘기는 TextInput을 두고 iOS 시뮬레이터에서 한글을 쳐서 확인한다."
tags: [gorhom-bottom-sheet, textinput, ime, hangul, korean, ios, portal, uncontrolled-input]
---

# bottom sheet 안의 제어 입력 칸에서 iOS 한글 조합이 풀린다

## Problem
`BottomSheetModal`(포털)로 그린 시트 안의 입력 칸에 `value`를 내려 주면, iOS에서 한글을 칠 때마다 조합 중인 글자가 확정되어 버린다. 그래서 자모가 풀려 들어가고 추천 단어도 뜨지 않는다.

## Root cause
포털을 거친 `value`는 한 렌더 늦게 도착한다. 제어 입력 칸은 그 값을 네이티브 텍스트로 다시 넣는데, 이때 IME가 조합 중이던 글자를 확정한다.

실기기(시뮬레이터)에서 하나씩 빼 보며 확인한 것:
- 시트 밖의 평범한 RN `TextInput`은 괜찮다.
- 시트 안에서는 `BottomSheetTextInput`이 아닌 평범한 `TextInput`도 깨진다. 우리 래퍼 문제가 아니다.
- `pointerEvents`나 키보드 관련 props를 빼도 그대로다.
- 상태를 `SheetInput` 안으로 옮겨도 그대로다.
- 비제어 입력(`defaultValue`만)은 조합이 정상이다.

## Solution
`SheetInput`은 네이티브 칸에 `value`를 절대 넘기지 않는다(목록 순서·항목 누르기 브랜치에서 고침, 병합 전).
- 마운트 값과 `onChangeText`로 낸 글자를 순서대로 `seen`에 모은다.
- 들어온 `value`가 `seen`에 없을 때만 바깥 변경(초기화 등)으로 보고, `key`를 바꿔 새 `defaultValue`로 다시 마운트한다.
- `seen`에 있으면 자기 글자의 늦은 메아리다. 그 앞의 항목만 지운다.

처음 고친 방식은 "value가 바뀌면 다시 마운트"였다. 그러자 늦게 도착한 자기 글자('ㅎ')를 바깥 변경으로 보고 조합 중에 다시 마운트해서 글자가 빠졌다. 이 방식은 리뷰도 통과했지만 기기에서 틀렸다.

## Prevention
- `eslint.config.js`의 `no-restricted-imports`가 `components/ui/sheet.tsx` 밖에서 `BottomSheetTextInput`을 import하면 오류를 낸다. 시트 안 입력 칸은 `SheetInput`을 쓴다. 다만 lint는 시트 내용에 평범한 RN `TextInput`을 넣는 경우는 잡지 못한다. 그것도 깨지므로 쓰지 않는다.
- 호출부는 `onChangeText`로 받은 글자를 그대로 `value`로 돌려준다. 다듬기(trim 등)를 `onChangeText`에서 하면 매 글자가 "낸 적 없는 값"이 되어 다시 마운트되고 조합이 깨진다. 다듬기는 저장할 때 한다.
- Jest에는 IME가 없어 이 버그를 볼 수 없다. 시트 입력 칸을 바꾸면 iOS 시뮬레이터에서 한글('하이')을 직접 쳐 보고 저장 결과까지 확인한다. 증상을 시뮬레이터 키보드 설정 탓으로 넘기지 않는다(실제로 한 번 그렇게 잘못 판단했다).

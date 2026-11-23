# 대화상자·메뉴를 bottom sheet로 바꾸기

## 왜

Cart Note는 모바일 앱인데, 입력·확인 창은 화면 가운데 뜨는 웹식 modal(`@rn-primitives/dialog`)이고 목록 메뉴(⋯)·그룹 전환은 웹식 팝오버(`@rn-primitives/dropdown-menu`)다. 앱 사용자에게 익숙한 형태는 화면 아래에서 올라오는 bottom sheet다. 또 modal 폭이 좁아(`max-w-[calc(100%-2rem)]`에 내용 폭) 입력 칸과 글자가 잘 안 보인다.

## 목표

- 앱의 모든 대화상자(입력·확인)와 드롭다운 메뉴를 같은 모양의 bottom sheet로 바꾼다.
- 시트는 화면 폭 전체를 쓴다.
- 키보드가 올라와도 입력 칸과 저장 버튼이 가려지지 않는다.
- 아래로 끌거나 바깥(배경)을 누르면 닫힌다. 닫기는 지금의 "취소"와 같은 의미다.

## 하지 않는 것

- 화면(route) 구조, 데이터 흐름, mutation 동작은 바꾸지 않는다. 바뀌는 것은 창을 담는 그릇뿐이다.
- 지점 관리 화면(`list/[id]/locations`) 같은 전체 화면은 그대로 둔다.
- 토스트, 색·글꼴 등 시각 디자인 전반은 손대지 않는다.

## 실패로 보는 것

- 키보드가 입력 칸이나 저장 버튼을 덮는다.
- 시트를 닫는 동작이 지금과 다른 의미가 된다(예: 빈 그룹 정리 시트를 끌어 닫았는데 삭제가 실행됨, 닫기 콜백이 두 번 실행됨).
- 항목 편집 시트에 이전 항목의 입력값이 남는다(지금은 `key={item.id}`로 막는다).
- 기존 테스트가 찾는 버튼 역할·이름(예: `목록 메뉴`, 메뉴 항목 글자, `취소`/`삭제`)이 바뀌어 회귀를 못 잡게 된다.

## 방식 (Approaches)

1. **`@gorhom/bottom-sheet`로 공통 시트 컴포넌트를 만든다 — 선택.** 이미 있는 reanimated·gesture-handler 위에서 동작하고 Expo Go에서도 돈다. 키보드 따라 올라가기, 끌어서 닫기, 내용 높이에 맞추기를 제공한다. 지금처럼 상태값(`open`/`mode`)으로 여닫는 코드를 거의 그대로 쓸 수 있다. 비용은 의존성 하나.
2. expo-router `formSheet` 화면 — iOS 기본 시트라 가장 네이티브하지만, 시트마다 route가 되어 15곳을 다시 짜야 하고 확인 창을 route로 만드는 것이 어색하다.
3. 메뉴·확인은 iOS `ActionSheetIOS`, 입력만 1번 — 가장 iOS답지만 Android를 따로 처리해야 하고 앱 안 시트 모양이 두 가지가 된다.

사용자가 1번을 골랐다(2026-11-23).

## 설계

### 공통 컴포넌트 (`components/ui/sheet.tsx`)

세 가지를 만든다. 모두 제어형(controlled)이다.

- **`Sheet`** — `open`, `onOpenChange(open)`, `children`. `BottomSheetModal`을 감싼다.
  - `open`이 true가 되면 `present()`, false가 되면 `dismiss()`.
  - 사용자가 끌어 닫거나 배경을 누르면 `onOpenChange(false)`를 **한 번만** 부른다. `open`이 이미 false여서 코드가 닫은 경우에는 다시 부르지 않는다.
  - 내용 높이에 맞춘다(dynamic sizing). 화면 폭 전체, 위쪽 모서리만 둥글게, 위에 손잡이(handle).
  - 배경(backdrop)은 반투명이고, 누르면 닫힌다.
  - 키보드: `keyboardBehavior="interactive"`, `keyboardBlurBehavior="restore"`, Android는 `android_keyboardInputMode="adjustResize"`.
  - 아래쪽은 safe area(홈 인디케이터)만큼 띄운다.
  - 닫혀 있을 때는 children을 렌더링하지 않는다(지금 Dialog와 같다 — 테스트가 "안 보임"을 확인할 수 있어야 하고, 폼 상태가 남지 않아야 한다).
  - 하위 조각: `SheetHeader`, `SheetTitle`, `SheetDescription`, `SheetFooter`. Footer의 버튼은 화면 폭 전체로 세로로 쌓는다(주 동작이 위, 취소가 아래).
- **`SheetInput`** — `BottomSheetTextInput`에 지금 `Input`과 같은 스타일을 입힌 것. 시트 안의 입력 칸은 이것을 써야 키보드 처리가 된다.
- **`ConfirmSheet`** — `open`, `title`, `description?`, `confirmLabel`, `cancelLabel`(기본 `취소`), `destructive?`, `onConfirm`, `onCancel`. 끌어 닫기·배경 누르기는 `onCancel`과 같다.
- **`MenuSheet`** — 트리거 버튼과 항목 목록. 항목은 `{ label, onPress, disabled?, destructive?, selected? }`이고 구분선을 넣을 수 있다. 항목을 누르면 시트를 닫고 `onPress`를 부른다. 맨 아래에 `취소` 행. 트리거는 지금 드롭다운 트리거와 같은 `accessibilityLabel`을 받는다.

루트 레이아웃(`app/_layout.tsx`)의 `GestureHandlerRootView` 안에 `BottomSheetModalProvider`를 둔다.

```
┌──────────────────────────────┐
│            ───               │  ← 손잡이
│ 목록 이름 변경                │  ← SheetTitle
│ ┌──────────────────────────┐ │
│ │ 사야할것                  │ │  ← SheetInput (전체 폭)
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │          저장             │ │  ← 주 동작
│ └──────────────────────────┘ │
└──────────────────────────────┘
        (키보드 위에 붙음)
```

### 바꿀 곳 (15곳)

| 위치 | 지금 | 바꿀 것 |
|---|---|---|
| `app/(app)/index.tsx` 목록 추가 | Dialog + Input | Sheet + SheetInput |
| `app/(app)/list/[id]/index.tsx` ⋯ 메뉴 | DropdownMenu | MenuSheet (`목록 메뉴`) |
| 같은 파일: 선택 항목 삭제, 목록 비우기, 목록 삭제 | Dialog 확인 | ConfirmSheet |
| 같은 파일: 목록 이름 변경 | Dialog + Input | Sheet + SheetInput |
| `src/items/ItemEditSheet.tsx` 항목 편집 | Dialog + Input 2개 | Sheet + SheetInput 2개, `key={item.id}` 유지 |
| `src/items/MoveSheet.tsx` 이동할 목록 | Dialog + 목록 버튼 | Sheet + 목록 행 |
| `src/groups/GroupSwitcher.tsx` 그룹 전환 | DropdownMenu | MenuSheet (현재 그룹 `selected`) |
| `src/groups/GroupNameDialog.tsx` 그룹 이름/새 그룹 | Dialog + Input | Sheet + SheetInput |
| `app/(app)/settings.tsx` 코드 재발급·나가기·로그아웃 | Dialog 확인 | ConfirmSheet |
| 같은 파일: 내 이름 변경 | Dialog + Input | Sheet + SheetInput |
| `app/(auth)/join.tsx` 빈 그룹 정리 | Dialog 확인(닫기 = 유지) | ConfirmSheet(`유지`/`삭제`, 닫기 = 유지) |

모두 옮긴 뒤 쓰이지 않는 `components/ui/dialog.tsx`, `alert-dialog.tsx`, `dropdown-menu.tsx`와 `@rn-primitives/dialog`·`alert-dialog`·`dropdown-menu` 의존성을 지운다. `@rn-primitives/portal`은 다른 곳에서 안 쓰면 같이 지운다.

### 테스트

- Jest에서는 `BottomSheetModal`을 "열려 있으면 children을 그대로 렌더링"하는 목으로 바꾼다(라이브러리의 `@gorhom/bottom-sheet/mock`을 쓰거나 같은 동작을 직접 둔다). 열림/닫힘은 우리 `Sheet`가 children 렌더링으로 정하므로 목과 무관하게 지금 테스트가 그대로 의미를 가진다.
- `Sheet`, `ConfirmSheet`, `MenuSheet` 자체 테스트: 열림/닫힘 렌더링, 끌어 닫기(목에서 `onDismiss` 호출)에 `onOpenChange(false)`/`onCancel`이 한 번만 불림, 메뉴 항목을 누르면 닫히고 `onPress`가 불림, `disabled` 항목은 눌리지 않음.
- 기존 화면 테스트(`list-detail`, `settings`, `onboarding/guard` 등)는 버튼 역할·글자로 찾으므로 고치지 않고 통과해야 한다. 바뀐 것이 있다면 회귀로 본다.

### 확인

개발 빌드는 이 Mac의 Xcode(16.4)로는 만들 수 없으므로 Expo Go(iOS 시뮬레이터)에서 본다: 각 시트가 전체 폭으로 올라오는지, 키보드가 입력 칸을 덮지 않는지, 끌어 닫기가 취소로 동작하는지.

## 세부 결정 (설계자 판단)

빌더 검토에서 나온 질문을 아래처럼 정했다. 모두 설계자 판단이다.

1. **호환성 먼저 증명.** 쓸 버전은 `@gorhom/bottom-sheet` 5.2.x(최신 5.2.14, peer: reanimated ≥3.16 또는 4, gesture-handler ≥2.16.1)이고 `npx expo install`로 설치한다. 이 앱은 gesture-handler 3.3 / reanimated 4.7이다. 그래서 첫 작업은 `Sheet` 하나만 만들어 Expo Go에서 실제로 여닫히는지(끌어 닫기, 키보드 포함) 확인하는 것이다. 확인하기 전에는 다른 곳을 옮기지 않는다. 안 되면 같은 컴포넌트 API(`Sheet`/`ConfirmSheet`/`MenuSheet`/`SheetInput`)는 그대로 두고 내부만 RN `Modal` + reanimated로 직접 구현한다. 호출하는 15곳은 영향을 받지 않는다.
2. **Jest 설정은 고친다.** `jest.setup.ts`에 라이브러리 전역 목을 둔다. `BottomSheetModal`은 present/dismiss를 동기로 처리하고, dismiss 때 `onDismiss`를 바로 부른다. `BottomSheetModalProvider`, `BottomSheetTextInput`(→ `TextInput`), `BottomSheetBackdrop`, `BottomSheetView`도 목으로 둔다. 필요하면 `transformIgnorePatterns`도 고친다. "기존 테스트를 고치지 않는다"는 말은 **화면 테스트의 조회와 기대값**에만 해당한다. 설정과 감싸는 컴포넌트(wrapper)는 고쳐도 된다.
3. **테스트의 `<PortalHost />`.** 화면 테스트 4개(`home`, `list-detail`, `settings`, `move`)가 `PortalHost`로 감싼다. 이 감쌈은 지운다. 목에서는 Provider가 필요 없으므로 따로 감쌀 필요도 없다. 다른 곳에서 portal을 안 쓰면 의존성도 지운다.
4. **메뉴에서 다른 시트 열기.** `MenuSheet` 항목을 누르면 메뉴를 닫는다. 그 항목의 `onPress`는 닫는 애니메이션이 끝난 뒤(`onDismiss`) 부른다. 두 시트가 동시에 움직이지 않게 하려는 것이다. 목은 dismiss 때 `onDismiss`를 바로 부르므로 테스트에서는 즉시 실행된다.
5. **닫기 콜백은 한 번만.** `Sheet`의 `onDismiss`에서는 부모의 `open`이 아직 true일 때만 `onOpenChange(false)`를 부른다(최신 `open`을 ref로 본다). 코드가 `open=false`로 닫은 경우에는 부르지 않는다. `ConfirmSheet`는 확인을 누르면 ref에 "확인됨"을 기록한다. 그 뒤의 dismiss에서는 `onCancel`을 부르지 않는다. 다음 경우를 테스트로 고정한다.
   - `join.tsx`에서 `삭제`를 누르면 `answer(true)`만 한 번 불린다(`answer(false)`가 뒤따르지 않는다).
   - 끌어 닫으면 `answer(false)`가 한 번만 불린다.
6. **닫는 동안의 내용.** `open`이 false가 되어도 닫는 애니메이션이 끝날 때(`onDismiss`)까지 children을 유지한다. 그 뒤에 지운다. 목에서는 바로 지워진다. `ItemEditSheet`는 `key={item.id}`를 그대로 둔다.
7. **역할(role)과 이름.**
   - `MenuSheet` 항목은 지금처럼 `accessibilityRole="menuitem"`이다. 기존 테스트가 `findByRole('menuitem', …)`과 `toBeDisabled()`를 쓴다.
   - 트리거는 `button`이고, 받은 `accessibilityLabel`(예: `목록 메뉴`)을 그대로 쓴다.
   - 메뉴 맨 아래 `취소` 행은 `button`이다. 메뉴와 확인 시트는 동시에 열리지 않으므로 `취소`가 겹치지 않는다.
8. **Android.** `android_keyboardInputMode="adjustResize"`는 넣는다. 다만 이번 확인 범위는 iOS(Expo Go)이고, Android 실기 확인은 하지 않는다. 라이브러리에는 Android 하드웨어 뒤로가기가 시트 대신 화면을 닫는 이슈가 라이브러리 저장소에 열려 있다. 그래서 시트가 열려 있으면 `BackHandler`로 시트를 닫고 이벤트를 소비한다. 이 동작은 단위 테스트로 확인한다.
9. **`SheetInput` 스타일.** `components/ui/input.tsx`의 클래스 문자열을 상수로 빼서 둘이 함께 쓴다.

## 빌더에게 맡기는 것

- 시트 애니메이션 속도, 배경 투명도, 손잡이 모양 같은 세부 값.
- `MenuSheet` 행 높이·구분선 표현.
- 목(mock)을 라이브러리 것으로 쓸지 직접 둘지.

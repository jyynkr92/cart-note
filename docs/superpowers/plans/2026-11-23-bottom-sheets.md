# Bottom Sheet 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱의 대화상자(입력·확인)와 드롭다운 메뉴 15곳을 화면 폭 전체를 쓰는 bottom sheet로 바꾼다.

**Architecture:** `@gorhom/bottom-sheet`의 `BottomSheetModal`을 감싼 제어형 컴포넌트 `Sheet`·`SheetInput`·`ConfirmSheet`·`MenuSheet`를 `components/ui/sheet.tsx`에 만든다. 각 화면은 지금의 상태값(`open`/`mode`)으로 이 컴포넌트를 여닫는다. 다 옮긴 뒤 `@rn-primitives`의 dialog·alert-dialog·dropdown-menu·portal을 지운다.

**Tech Stack:** Expo 58, React Native 0.88, NativeWind, reanimated 4.7, gesture-handler 3.3, `@gorhom/bottom-sheet` 5.2.x, Jest + RNTL 14(비동기 API는 반드시 await).

**Spec:** `docs/superpowers/specs/2026-11-23-bottom-sheets-design.md`

## Global Constraints

- 라이브러리는 `npx expo install @gorhom/bottom-sheet`로 설치한다(5.2.x).
- 화면 테스트의 조회·기대값은 바꾸지 않는다. Jest 설정(`jest.setup.ts`, `jest.config.js`)과 테스트 wrapper(`<PortalHost />` 제거)는 바꿔도 된다.
- 메뉴 항목은 `accessibilityRole="menuitem"`. 메뉴 트리거는 `button` + 받은 `accessibilityLabel`. 비활성 항목은 `accessibilityState={{ disabled: true }}`.
- 끌어 닫기·배경 누르기 = 취소. 닫기 콜백(`onOpenChange(false)`/`onCancel`)은 사용자 닫기 한 번에 정확히 한 번, 코드가 닫을 때(`open=false`)와 확인 뒤에는 0번.
- 시트는 화면 폭 전체, 위쪽 모서리만 둥글게, 손잡이 있음, 아래쪽 safe area만큼 여백.
- 시트 안 입력 칸은 `SheetInput`만 쓴다. 키보드: `keyboardBehavior="interactive"`, `keyboardBlurBehavior="restore"`, `android_keyboardInputMode="adjustResize"`.
- 화면 문구(제목·버튼 글자)는 지금 Dialog의 문구를 그대로 쓴다.
- 커밋 메시지는 한국어, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 반드시 지킬 교훈: `docs/solutions/ui-bugs/optimistic-delete-then-navigate-flashes-not-found.md` — 목록 삭제·그룹 나가기 확인 뒤 이동하는 흐름의 순서(낙관적 삭제 → 이동)를 바꾸지 않는다.

## Review Focus

1. 메뉴 항목(예: 목록 메뉴 → 이름 변경/목록 삭제)에서 다음 시트로 넘어갈 때 다음 시트가 확실히 열려야 한다 → Task 2 `MenuSheet` 테스트 "menu item opens after dismiss", Task 3 기존 list-detail 테스트.
2. 빈 그룹 정리에서 `삭제`를 누르면 `answer(true)`만, 끌어 닫으면 `answer(false)`만 한 번 → Task 4 join 테스트.
3. 항목 A 편집을 닫고 항목 B 편집을 열면 B의 값이 보여야 한다 → Task 3 ItemEditSheet 테스트.
4. Android 하드웨어 뒤로가기는 열린 시트만 닫고 화면은 그대로 → Task 1 `Sheet` 테스트.
5. 시트가 닫힌 상태에서는 내용이 렌더링되지 않아야 한다(기존 "안 보임" 테스트가 의미를 가짐) → Task 1 `Sheet` 테스트.

---

### Task 1: 라이브러리 설치와 `Sheet`·`SheetInput`

**Files:**
- Modify: `package.json`, `package-lock.json` (설치)
- Modify: `app/_layout.tsx` — `GestureHandlerRootView` 안에 `BottomSheetModalProvider`
- Modify: `jest.setup.ts` — `@gorhom/bottom-sheet` 전역 목
- Modify: `components/ui/input.tsx` — 클래스 문자열을 `inputClassName` 상수로 export
- Create: `components/ui/sheet.tsx`
- Test: `__tests__/ui/sheet.test.tsx`

**Interfaces:**
- Produces (`components/ui/sheet.tsx`):
  - `Sheet(props: { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode; onClosed?: () => void }): JSX.Element` — `onClosed`는 닫는 애니메이션이 끝난 뒤(`onDismiss`) 매번 불린다(사용자·코드 닫기 모두). Task 2가 쓴다.
  - `SheetHeader`, `SheetTitle`, `SheetDescription`, `SheetFooter`: `({ className?, children }) => JSX.Element`. `SheetTitle`은 `accessibilityRole="header"`. `SheetFooter`는 버튼을 세로로 전체 폭으로 쌓는다.
  - `SheetInput`: `React.ComponentProps<typeof TextInput>` 그대로 받는 `BottomSheetTextInput` 래퍼, 클래스는 `inputClassName` + `className`.
- Produces (`components/ui/input.tsx`): `export const inputClassName: string`.

- [ ] **Step 1: 설치와 목**

`npx expo install @gorhom/bottom-sheet`. `jest.setup.ts`에 목을 둔다: `BottomSheetModal`은 `forwardRef`로 `present()`(내부 상태로 children 표시)와 `dismiss()`(children 숨기고 `props.onDismiss?.()`를 동기로 호출)를 노출한다. `BottomSheetModalProvider`·`BottomSheetView`는 children 통과, `BottomSheetTextInput`은 RN `TextInput`, `BottomSheetBackdrop`은 `null`. 필요하면 `jest.config.js`의 `transformIgnorePatterns`에 `@gorhom/.*`를 더한다.

- [ ] **Step 2: 실패하는 테스트 작성 (`__tests__/ui/sheet.test.tsx`)**

```tsx
it('renders children only while open', async () => {
  const { rerender } = await render(<Sheet open={false} onOpenChange={jest.fn()}><Text>내용</Text></Sheet>);
  expect(screen.queryByText('내용')).toBeNull();
  await rerender(<Sheet open onOpenChange={jest.fn()}><Text>내용</Text></Sheet>);
  expect(screen.getByText('내용')).toBeTruthy();
  await rerender(<Sheet open={false} onOpenChange={jest.fn()}><Text>내용</Text></Sheet>);
  expect(screen.queryByText('내용')).toBeNull();
});
it('user dismiss calls onOpenChange(false) exactly once', /* 목의 onDismiss를 사용자 닫기처럼 호출 → toHaveBeenCalledTimes(1), toHaveBeenCalledWith(false) */);
it('programmatic close (open=false) does not call onOpenChange', /* rerender open=false → onOpenChange not called; onClosed called once */);
it('android back closes an open sheet and consumes the event', /* BackHandler 'hardwareBackPress' 핸들러가 true를 돌려주고 onOpenChange(false) 한 번 */);
it('back is not consumed when closed', /* 닫힌 상태에서 등록된 핸들러 없음 또는 false */);
it('SheetInput renders a text input with the given placeholder', /* getByPlaceholderText */);
```

사용자 닫기는 목 인스턴스의 `onDismiss`를 직접 호출해서 흉내 낸다(목이 마지막 props를 노출하게 하거나 `UNSAFE_getByType`으로 props를 얻는다).

- [ ] **Step 3: 테스트 실패 확인** — Run: `npx jest __tests__/ui/sheet.test.tsx` → FAIL (모듈 없음)

- [ ] **Step 4: `Sheet` 구현**

`open` 변화에 따라 `ref.current?.present()` / `dismiss()`. 최신 `open`은 ref로 보고, `onDismiss`에서 그 값이 true일 때만 `onOpenChange(false)`를 부른다. children은 `open`이 true가 된 순간부터 `onDismiss`까지 렌더링한다(닫는 애니메이션 동안 유지). `enableDynamicSizing`, 배경은 `BottomSheetBackdrop`(`pressBehavior="close"`, `appearsOnIndex={0}`, `disappearsOnIndex={-1}`). 하단 여백은 `useSafeAreaInsets().bottom`. 열려 있을 때만 `BackHandler`를 등록해 `onOpenChange(false)`를 부르고 `true`를 돌려준다.

- [ ] **Step 5: 테스트 통과 확인** — Run: `npx jest __tests__/ui/sheet.test.tsx` → PASS. 이어서 `npm test`, `npm run typecheck`, `npm run lint` 모두 통과(경고 수는 24 이하).

- [ ] **Step 6: 커밋** — `feat(ui): bottom sheet 공통 컴포넌트(Sheet, SheetInput)`

> 컨트롤러 게이트: 이 작업 뒤, 다른 작업 전에 컨트롤러가 Expo Go(iOS 시뮬레이터)에서 `Sheet`가 실제로 여닫히는지 확인한다(임시 화면이나 Task 3의 첫 화면으로). 안 되면 스펙의 대안(RN `Modal` + reanimated로 같은 API 구현)으로 Task 1을 다시 한다.

### Task 2: `ConfirmSheet`·`MenuSheet`

**Files:**
- Modify: `components/ui/sheet.tsx`
- Test: `__tests__/ui/sheet.test.tsx` (추가)

**Interfaces:**
- Consumes: Task 1의 `Sheet`(`onClosed` 포함), `SheetHeader`·`SheetTitle`·`SheetDescription`·`SheetFooter`, `Button`(`components/ui/button.tsx`).
- Produces:
  - `ConfirmSheet(props: { open: boolean; title: string; description?: React.ReactNode; confirmLabel: string; cancelLabel?: string /* 기본 '취소' */; destructive?: boolean; confirmDisabled?: boolean; onConfirm: () => void; onCancel: () => void }): JSX.Element`. 확인 버튼은 `destructive`면 `variant="destructive"`, 아니면 기본. 취소 버튼은 `variant="outline"`. 확인을 누르면 `onConfirm`만 부른다(시트를 닫는 것은 부모가 `open=false`로). 끌어 닫기·배경·뒤로가기는 `onCancel`.
  - `type MenuSheetItem = { label: string; onPress: () => void; disabled?: boolean; destructive?: boolean; selected?: boolean } | 'separator'`
  - `MenuSheet(props: { trigger: (open: () => void) => React.ReactNode; items: MenuSheetItem[]; title?: string }): JSX.Element` — 열림 상태는 내부에 둔다. 항목을 누르면 닫고, 그 항목의 `onPress`는 `onClosed` 때 부른다. 맨 아래 `취소` 행(`button`)은 닫기만 한다. `selected` 항목은 굵게.

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
it('confirm calls onConfirm only, never onCancel', /* 확인 버튼 press → onConfirm 1번; 부모가 open=false로 rerender → onCancel 0번 */);
it('user dismiss calls onCancel once', /* 목 onDismiss 호출 → onCancel 1번, onConfirm 0번 */);
it('cancel button calls onCancel once', /* '취소' press → onCancel 1번 */);
it('menu items are menuitems; disabled ones do not fire', async () => {
  // trigger로 연 뒤
  expect(await screen.findByRole('menuitem', { name: '목록 비우기' })).toBeDisabled();
});
it('menu item onPress runs after the menu has closed', /* 항목 press → 메뉴 내용이 사라지고 onPress 1번 */);
it('menu cancel row closes without calling any item', /* '취소' press → 어떤 onPress도 0번 */);
```

- [ ] **Step 2: 실패 확인** — Run: `npx jest __tests__/ui/sheet.test.tsx` → 새 테스트 FAIL
- [ ] **Step 3: 구현** — `ConfirmSheet`은 "확인됨" ref를 두고, `Sheet`의 `onOpenChange(false)`가 오면 그 ref가 false일 때만 `onCancel`. `open`이 다시 true가 되면 ref를 초기화. `MenuSheet`은 눌린 항목을 ref에 담고 `onClosed`에서 실행 후 비운다.
- [ ] **Step 4: 통과 확인** — `npx jest __tests__/ui/sheet.test.tsx`, `npm test`, `npm run typecheck`, `npm run lint` 통과
- [ ] **Step 5: 커밋** — `feat(ui): ConfirmSheet, MenuSheet`

### Task 3: 목록 상세 화면과 항목 시트 옮기기

**Files:**
- Modify: `app/(app)/list/[id]/index.tsx` — ⋯ 메뉴(`DropdownMenu` → `MenuSheet`, 트리거 라벨 `목록 메뉴`), `deleteSelected`·`clear`·`delete` → `ConfirmSheet`, `rename` → `Sheet` + `SheetInput`
- Modify: `src/items/ItemEditSheet.tsx` — `Sheet` + `SheetInput` 2개, `key={item.id}` 유지
- Modify: `src/items/MoveSheet.tsx` — `Sheet`, 목록마다 전체 폭 버튼
- Modify: `__tests__/list-detail.test.tsx`, `__tests__/items/move.test.tsx` — `<PortalHost />` 제거만
- Test: `__tests__/items/item-edit-sheet.test.tsx` (새로)

**Interfaces:**
- Consumes: Task 1·2의 모든 export. 메뉴 항목 문구: `완료 항목 지우기`, `목록 비우기`, `separator`, `이름 변경`, (`store`일 때) `지점 관리`, (`inbox` 아닐 때) `목록 삭제`. 비활성 조건은 지금 코드 그대로.

- [ ] **Step 1: 실패하는 테스트 작성 (`__tests__/items/item-edit-sheet.test.tsx`)**

```tsx
it('switching from item A to item B shows B values', async () => {
  // ItemEditSheet item=A → rerender item=null → rerender item=B
  expect(screen.getByDisplayValue('B 이름')).toBeTruthy();
  expect(screen.queryByDisplayValue('A 이름')).toBeNull();
});
it('save sends trimmed name and note', /* onSave toHaveBeenCalledWith({ id, name, note }) */);
```

- [ ] **Step 2: 실패 확인** — 지금 Dialog 구현으로는 목 없이 통과할 수 있다. 그 경우 이 테스트는 회귀 고정용이고, 실패 확인 대신 "통과"를 기록한다.
- [ ] **Step 3: 세 파일 옮기기.** 문구·조건·핸들러는 그대로. `ItemEditSheet`의 `onClose`는 `Sheet`의 `onOpenChange(false)`에 연결.
- [ ] **Step 4: 확인** — `npx jest __tests__/list-detail.test.tsx __tests__/items` 통과(조회·기대값 수정 없이). `npm test`, `npm run typecheck`, `npm run lint` 통과.
- [ ] **Step 5: 커밋** — `feat: 목록 상세의 메뉴·확인·입력 창을 bottom sheet로`

### Task 4: 홈·그룹·설정·참여 화면 옮기기

**Files:**
- Modify: `app/(app)/index.tsx` — 목록 추가 `Sheet` + `SheetInput`(마트/온라인 radio 그대로)
- Modify: `src/groups/GroupSwitcher.tsx` — `MenuSheet`(그룹마다 항목, 현재 그룹 `selected`, `separator`, `이름 변경`, `+ 새 그룹`, `코드로 참여`). 트리거는 지금 버튼 모양(`{family.name} ▾`)
- Modify: `src/groups/GroupNameDialog.tsx` — `Sheet` + `SheetInput`
- Modify: `app/(app)/settings.tsx` — `regenerate`(`재발급`, 기본)·`leave`(`나가기`, destructive)·`logout`(`로그아웃`, destructive) → `ConfirmSheet`; `name` → `Sheet` + `SheetInput`. 본문 문장은 `description`으로. `busy`는 `confirmDisabled`
- Modify: `app/(auth)/join.tsx` — 빈 그룹 정리 → `ConfirmSheet`(`confirmLabel="삭제"`, `cancelLabel="유지"`, destructive, `onConfirm={() => void answer(true)}`, `onCancel={() => void answer(false)}`)
- Modify: `__tests__/home.test.tsx`, `__tests__/settings.test.tsx`, `__tests__/onboarding/join.test.tsx` — `<PortalHost />` 제거만
- Test: `__tests__/onboarding/join.test.tsx` (추가)

**Interfaces:**
- Consumes: Task 1·2의 모든 export.

- [ ] **Step 1: 실패하는 테스트 작성 (join)**

```tsx
it('deleting an empty group answers true once and never false', /* '삭제' press → deleteFamilyIfEmpty 1번 호출, 다음 그룹 질문 또는 종료; 유지 경로 호출 0번 */);
it('dismissing the cleanup sheet keeps the group (answers false once)', /* 목 onDismiss 호출 → delete 호출 0번, 다음 단계로 한 번만 진행 */);
```

(`answer`가 실제로 부르는 함수 이름은 `join.tsx`에서 확인해 그 목으로 단언한다.)

- [ ] **Step 2: 실패 확인** — `npx jest __tests__/onboarding/join.test.tsx` → 목 onDismiss 경로가 아직 Dialog라 FAIL
- [ ] **Step 3: 다섯 파일 옮기기.** 문구·조건·핸들러는 그대로. 교훈 문서(Global Constraints)의 삭제·나가기 뒤 이동 순서를 지킨다.
- [ ] **Step 4: 확인** — `npm test`(기존 화면 테스트 조회·기대값 수정 없이), `npm run typecheck`, `npm run lint` 통과
- [ ] **Step 5: 커밋** — `feat: 홈·그룹·설정·참여 화면의 창을 bottom sheet로`

### Task 5: 옛 컴포넌트와 의존성 지우기

**Files:**
- Delete: `components/ui/dialog.tsx`, `components/ui/alert-dialog.tsx`, `components/ui/dropdown-menu.tsx`
- Modify: `app/_layout.tsx` — `PortalHost` 제거(다른 곳에서 안 쓰면)
- Modify: `package.json`, `package-lock.json` — `@rn-primitives/dialog`, `@rn-primitives/alert-dialog`, `@rn-primitives/dropdown-menu`, (안 쓰면) `@rn-primitives/portal` 제거
- Modify: `jest.setup.ts` — 드롭다운용 `View.prototype.measure` 대체(beforeAll/afterAll)와 쓰이지 않는 목 제거

- [ ] **Step 1: 남은 사용처 확인** — Run: `grep -rnE "rn-primitives/(dialog|alert-dialog|dropdown-menu|portal)|components/ui/(dialog|alert-dialog|dropdown-menu)|PortalHost" app src components __tests__ test-utils` → 지울 파일 자신 외에는 결과 없음
- [ ] **Step 2: 지우고 `npm uninstall`**
- [ ] **Step 3: 확인** — `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` 통과
- [ ] **Step 4: 커밋** — `chore: 쓰지 않는 dialog·dropdown 컴포넌트와 의존성 제거`

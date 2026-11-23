import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { BackHandler, Pressable, Text } from 'react-native';
import { inputClassName } from '@/components/ui/input';
import {
  ConfirmSheet,
  MenuSheet,
  Sheet,
  SheetInput,
  type MenuSheetItem,
} from '@/components/ui/sheet';
import * as BottomSheetMock from '@/test-utils/bottom-sheet';
import { dismissSheetByUser, holdSheetDismissals } from '@/test-utils/bottom-sheet';

type BackHandlerFn = () => boolean | null | undefined;

const removed = new Set<unknown>();

/** BackHandler.addEventListener에 등록된 핸들러를 모은다(RN 목은 jest.fn이라 호출 기록으로 본다). */
function activeBackHandlers(): BackHandlerFn[] {
  const add = BackHandler.addEventListener as jest.Mock;
  return add.mock.results
    .map((r, i) => ({
      sub: r.value as { remove: jest.Mock },
      h: add.mock.calls[i][1] as BackHandlerFn,
    }))
    .filter(({ sub }) => !removed.has(sub))
    .map(({ h }) => h);
}

beforeEach(() => {
  removed.clear();
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation(() => {
    const sub: { remove: jest.Mock } = { remove: jest.fn(() => removed.add(sub)) };
    return sub;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Sheet', () => {
  it('renders children only while open', async () => {
    const { rerender } = await render(
      <Sheet open={false} onOpenChange={jest.fn()}>
        <Text>내용</Text>
      </Sheet>
    );
    expect(screen.queryByText('내용')).toBeNull();
    await rerender(
      <Sheet open onOpenChange={jest.fn()}>
        <Text>내용</Text>
      </Sheet>
    );
    expect(screen.getByText('내용')).toBeTruthy();
    await rerender(
      <Sheet open={false} onOpenChange={jest.fn()}>
        <Text>내용</Text>
      </Sheet>
    );
    expect(screen.queryByText('내용')).toBeNull();
  });

  it('user dismiss calls onOpenChange(false) exactly once', async () => {
    const onOpenChange = jest.fn();
    const onClosed = jest.fn();
    const { rerender } = await render(
      <Sheet open onOpenChange={onOpenChange} onClosed={onClosed}>
        <Text>내용</Text>
      </Sheet>
    );
    await dismissSheetByUser();
    // 부모가 onOpenChange(false)를 받아 open을 내린다.
    await rerender(
      <Sheet open={false} onOpenChange={onOpenChange} onClosed={onClosed}>
        <Text>내용</Text>
      </Sheet>
    );
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('내용')).toBeNull();
  });

  it('programmatic close (open=false) does not call onOpenChange', async () => {
    const onOpenChange = jest.fn();
    const onClosed = jest.fn();
    const { rerender } = await render(
      <Sheet open onOpenChange={onOpenChange} onClosed={onClosed}>
        <Text>내용</Text>
      </Sheet>
    );
    await rerender(
      <Sheet open={false} onOpenChange={onOpenChange} onClosed={onClosed}>
        <Text>내용</Text>
      </Sheet>
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('can be opened again after closing', async () => {
    const onClosed = jest.fn();
    const sheet = (open: boolean) => (
      <Sheet open={open} onOpenChange={jest.fn()} onClosed={onClosed}>
        <Text>내용</Text>
      </Sheet>
    );
    const { rerender } = await render(sheet(true));
    await rerender(sheet(false));
    await rerender(sheet(true));
    expect(screen.getByText('내용')).toBeTruthy();
    await rerender(sheet(false));
    expect(onClosed).toHaveBeenCalledTimes(2);
  });

  it('a late onDismiss from a programmatic close does not close a reopened sheet', async () => {
    const onOpenChange = jest.fn();
    const sheet = (open: boolean) => (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <Text>내용</Text>
      </Sheet>
    );
    const { rerender } = await render(sheet(true));
    const release = holdSheetDismissals();
    await rerender(sheet(false));
    await rerender(sheet(true));
    // 앞서 코드로 닫은 것의 onDismiss가 다시 연 뒤에야 도착한다.
    await release();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByText('내용')).toBeTruthy();
    // 그 뒤의 사용자 닫기는 여전히 사용자 닫기로 본다.
    await dismissSheetByUser();
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps children until the close animation finishes', async () => {
    const sheet = (open: boolean) => (
      <Sheet open={open} onOpenChange={jest.fn()}>
        <Text>내용</Text>
      </Sheet>
    );
    const { rerender } = await render(sheet(true));
    const release = holdSheetDismissals();
    await rerender(sheet(false));
    expect(screen.getByText('내용')).toBeTruthy();
    await release();
    expect(screen.queryByText('내용')).toBeNull();
  });

  it('a user dismiss followed by the parent closing still counts the next user dismiss', async () => {
    const onOpenChange = jest.fn();
    const sheet = (open: boolean) => (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <Text>내용</Text>
      </Sheet>
    );
    const { rerender } = await render(sheet(true));
    await dismissSheetByUser();
    await rerender(sheet(false));
    await rerender(sheet(true));
    await dismissSheetByUser();
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it('android back closes an open sheet and consumes the event', async () => {
    const onOpenChange = jest.fn();
    await render(
      <Sheet open onOpenChange={onOpenChange}>
        <Text>내용</Text>
      </Sheet>
    );
    const handlers = activeBackHandlers();
    expect(handlers).toHaveLength(1);
    let handled: boolean | null | undefined;
    await act(async () => {
      handled = handlers[0]();
    });
    expect(handled).toBe(true);
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('back is not consumed when closed', async () => {
    const { rerender } = await render(
      <Sheet open={false} onOpenChange={jest.fn()}>
        <Text>내용</Text>
      </Sheet>
    );
    expect(activeBackHandlers()).toHaveLength(0);
    await rerender(
      <Sheet open onOpenChange={jest.fn()}>
        <Text>내용</Text>
      </Sheet>
    );
    await rerender(
      <Sheet open={false} onOpenChange={jest.fn()}>
        <Text>내용</Text>
      </Sheet>
    );
    expect(activeBackHandlers()).toHaveLength(0);
  });
});

describe('SheetInput', () => {
  it('renders a text input with the given placeholder', async () => {
    await render(
      <Sheet open onOpenChange={jest.fn()}>
        <SheetInput placeholder="목록 이름" />
      </Sheet>
    );
    expect(screen.getByPlaceholderText('목록 이름')).toBeTruthy();
  });

  it('passes the shared Input classes to the sheet text input', async () => {
    // 렌더된 TextInput에서는 nativewind가 className을 소비해 없어지므로, 라이브러리 입력 칸을 받은 props를 기록하는 것으로 바꿔 본다.
    const input = jest
      .spyOn(
        jest.requireMock<typeof BottomSheetMock>('@gorhom/bottom-sheet'),
        'BottomSheetTextInput'
      )
      .mockImplementation(() => null);
    await render(
      <Sheet open onOpenChange={jest.fn()}>
        <SheetInput placeholder="목록 이름" className="mt-2" editable={false} />
      </Sheet>
    );
    const className: string = input.mock.lastCall?.[0].className ?? '';
    expect(className).toContain(inputClassName(false));
    expect(className).toContain('mt-2');
  });

  it('shares Input classes, including disabled opacity and the native placeholder colour', () => {
    // Jest에서는 nativewind가 className을 style로 바꾸지 않아 렌더 결과로는 비교할 수 없다.
    // 두 입력 칸 모두 inputClassName(editable)을 쓰므로 그 결과를 확인한다.
    expect(inputClassName(true)).not.toContain('opacity-50');
    expect(inputClassName(false)).toContain('opacity-50');
    expect(inputClassName()).toContain('placeholder:text-muted-foreground/50');
  });
});

describe('ConfirmSheet', () => {
  function renderConfirm(open: boolean, onConfirm: jest.Mock, onCancel: jest.Mock) {
    return (
      <ConfirmSheet
        open={open}
        title="목록 삭제"
        description="되돌릴 수 없다"
        confirmLabel="삭제"
        destructive
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
  }

  it('confirm calls onConfirm only, never onCancel', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const { rerender } = await render(renderConfirm(true, onConfirm, onCancel));
    expect(screen.getByRole('header', { name: '목록 삭제' })).toBeTruthy();
    expect(screen.getByText('되돌릴 수 없다')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '삭제' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await rerender(renderConfirm(false, onConfirm, onCancel));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByText('목록 삭제')).toBeNull();
  });

  it('a dismiss that arrives after confirm does not call onCancel', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    await render(renderConfirm(true, onConfirm, onCancel));
    await fireEvent.press(screen.getByRole('button', { name: '삭제' }));
    // 부모가 아직 닫지 않은 사이에 사용자가 끌어 닫는다.
    await dismissSheetByUser();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('user dismiss calls onCancel once', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const { rerender } = await render(renderConfirm(true, onConfirm, onCancel));
    await dismissSheetByUser();
    await rerender(renderConfirm(false, onConfirm, onCancel));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cancel button calls onCancel once', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const { rerender } = await render(renderConfirm(true, onConfirm, onCancel));
    await fireEvent.press(screen.getByRole('button', { name: '취소' }));
    await rerender(renderConfirm(false, onConfirm, onCancel));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('after a confirm, reopening counts a later user dismiss as cancel', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const { rerender } = await render(renderConfirm(true, onConfirm, onCancel));
    await fireEvent.press(screen.getByRole('button', { name: '삭제' }));
    await rerender(renderConfirm(false, onConfirm, onCancel));
    await rerender(renderConfirm(true, onConfirm, onCancel));
    await dismissSheetByUser();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('uses a custom cancel label and can disable confirm', async () => {
    const onConfirm = jest.fn();
    await render(
      <ConfirmSheet
        open
        title="빈 그룹"
        confirmLabel="삭제"
        cancelLabel="유지"
        confirmDisabled
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: '유지' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '삭제' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: '삭제' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('MenuSheet', () => {
  function renderMenu(items: MenuSheetItem[]) {
    return render(
      <MenuSheet
        title="목록"
        items={items}
        trigger={(open) => (
          <Pressable accessibilityRole="button" accessibilityLabel="목록 메뉴" onPress={open} />
        )}
      />
    );
  }

  async function openMenu() {
    await fireEvent.press(screen.getByRole('button', { name: '목록 메뉴' }));
  }

  it('menu items are menuitems; disabled ones do not fire', async () => {
    const clear = jest.fn();
    await renderMenu([
      { label: '이름 바꾸기', onPress: jest.fn() },
      'separator',
      { label: '목록 비우기', onPress: clear, disabled: true },
    ]);
    expect(screen.queryByRole('menuitem', { name: '목록 비우기' })).toBeNull();
    await openMenu();
    expect(await screen.findByRole('menuitem', { name: '목록 비우기' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: '이름 바꾸기' })).toBeEnabled();
    await fireEvent.press(screen.getByRole('menuitem', { name: '목록 비우기' }));
    expect(clear).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: '목록 비우기' })).toBeTruthy();
  });

  it('menu item onPress runs after the menu has closed', async () => {
    const rename = jest.fn();
    await renderMenu([{ label: '이름 바꾸기', onPress: rename }]);
    await openMenu();
    const release = holdSheetDismissals();
    await fireEvent.press(screen.getByRole('menuitem', { name: '이름 바꾸기' }));
    // 닫는 애니메이션이 끝나기 전에는 부르지 않는다.
    expect(rename).not.toHaveBeenCalled();
    await release();
    expect(rename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menuitem', { name: '이름 바꾸기' })).toBeNull();
  });

  it('menu cancel row closes without calling any item', async () => {
    const rename = jest.fn();
    await renderMenu([{ label: '이름 바꾸기', onPress: rename }]);
    await openMenu();
    await fireEvent.press(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('menuitem', { name: '이름 바꾸기' })).toBeNull();
    expect(rename).not.toHaveBeenCalled();
  });

  it('user dismiss closes without calling any item and the menu can reopen', async () => {
    const rename = jest.fn();
    await renderMenu([{ label: '이름 바꾸기', onPress: rename }]);
    await openMenu();
    await dismissSheetByUser();
    expect(screen.queryByRole('menuitem', { name: '이름 바꾸기' })).toBeNull();
    await openMenu();
    expect(screen.getByRole('menuitem', { name: '이름 바꾸기' })).toBeTruthy();
    expect(rename).not.toHaveBeenCalled();
  });

  it('a press followed by a reopen before the close finishes runs the item exactly once', async () => {
    const rename = jest.fn();
    await renderMenu([{ label: '이름 바꾸기', onPress: rename }]);
    await openMenu();
    const release = holdSheetDismissals();
    await fireEvent.press(screen.getByRole('menuitem', { name: '이름 바꾸기' }));
    await openMenu();
    await release();
    expect(rename).toHaveBeenCalledTimes(1);
    // 다시 열린 메뉴를 닫아도 앞서 누른 항목을 또 부르지 않는다.
    await fireEvent.press(screen.getByRole('button', { name: '취소' }));
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it('marks the selected item', async () => {
    await renderMenu([
      { label: '우리 집', onPress: jest.fn(), selected: true },
      { label: '회사', onPress: jest.fn() },
    ]);
    await openMenu();
    expect(screen.getByRole('menuitem', { name: '우리 집' })).toBeSelected();
    expect(screen.getByRole('menuitem', { name: '회사' })).not.toBeSelected();
  });
});

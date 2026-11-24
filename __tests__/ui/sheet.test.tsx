import * as React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { BackHandler, Pressable, Text, View } from 'react-native';
import { inputClassName } from '@/components/ui/input';
import {
  ConfirmSheet,
  MenuSheet,
  Sheet,
  SheetInput,
  useLastWhileOpen,
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
  it('an open sheet that unmounts calls neither onOpenChange nor onClosed', async () => {
    const onOpenChange = jest.fn();
    const onClosed = jest.fn();
    const { unmount } = await render(
      <Sheet open onOpenChange={onOpenChange} onClosed={onClosed}>
        <Text>내용</Text>
      </Sheet>
    );
    await unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onClosed).not.toHaveBeenCalled();
  });

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

  it('content is not touchable while the close animation runs', async () => {
    const press = jest.fn();
    const sheet = (open: boolean) => (
      <Sheet open={open} onOpenChange={jest.fn()}>
        <Pressable accessibilityRole="button" accessibilityLabel="저장" onPress={press} />
      </Sheet>
    );
    const { rerender } = await render(sheet(true));
    const release = holdSheetDismissals();
    await rerender(sheet(false));
    // 닫는 동안에도 내용은 보이지만 눌리지 않는다(두 번 눌러 같은 동작을 반복하지 않게).
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await fireEvent.press(screen.getByRole('button', { name: '저장' }));
    warn.mockRestore();
    expect(press).not.toHaveBeenCalled();
    await release();
  });

  it('content is not touchable while a user close (backdrop, drag) animates', async () => {
    const press = jest.fn();
    await render(
      <Sheet open onOpenChange={jest.fn()}>
        <Pressable accessibilityRole="button" accessibilityLabel="저장" onPress={press} />
      </Sheet>
    );
    const release = holdSheetDismissals();
    // 부모의 open은 onDismiss가 와야 바뀌므로, 닫기 시작(onAnimate → -1)만으로 막혀야 한다.
    await dismissSheetByUser();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await fireEvent.press(screen.getByRole('button', { name: '저장' }));
    warn.mockRestore();
    expect(press).not.toHaveBeenCalled();
    await release();
  });

  it('a reopen during a programmatic close re-presents without calling onClosed', async () => {
    const onClosed = jest.fn();
    const sheet = (open: boolean) => (
      <Sheet open={open} onOpenChange={jest.fn()} onClosed={onClosed}>
        <Text>내용</Text>
      </Sheet>
    );
    const { rerender } = await render(sheet(true));
    const release = holdSheetDismissals();
    await rerender(sheet(false));
    await rerender(sheet(true));
    await release();
    expect(onClosed).not.toHaveBeenCalled();
    expect(screen.getByText('내용')).toBeTruthy();
    await rerender(sheet(false));
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('shows the content it had when the close started until the close finishes (mock models the library)', async () => {
    const sheet = (open: boolean, label: string) => (
      <Sheet open={open} onOpenChange={jest.fn()}>
        <Text>{label}</Text>
      </Sheet>
    );
    const { rerender } = await render(sheet(true, '열린 내용'));
    const release = holdSheetDismissals();
    await rerender(sheet(false, '닫힌 뒤 내용'));
    // 닫는 렌더에서 바뀐 내용이 그대로 남는다(라이브러리는 닫는 중 내용 갱신을 멈춘다).
    expect(screen.getByText('닫힌 뒤 내용')).toBeTruthy();
    await rerender(sheet(false, '그 뒤 내용'));
    expect(screen.getByText('닫힌 뒤 내용')).toBeTruthy();
    expect(screen.queryByText('그 뒤 내용')).toBeNull();
    await release();
    expect(screen.queryByText(/내용/)).toBeNull();
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

describe('Sheet content container', () => {
  // 실제 라이브러리는 BottomSheetView의 레이아웃과 BottomSheetScrollView의 내용 크기를 같은 contentHeight에 쓴다.
  // 둘을 겹치면 안쪽 스크롤 영역 크기로 시트가 줄어든다(Jest에서는 높이를 잴 수 없어 구조로 본다).
  function markContainers() {
    const lib = jest.requireMock<typeof BottomSheetMock>('@gorhom/bottom-sheet');
    const mark = (testID: string) =>
      function Marked({ children }: { children?: React.ReactNode }) {
        return <View testID={testID}>{children}</View>;
      };
    jest.spyOn(lib, 'BottomSheetView').mockImplementation(mark('sheet-view'));
    jest
      .spyOn(lib, 'BottomSheetScrollView')
      .mockImplementation(mark('sheet-scroll') as unknown as typeof lib.BottomSheetScrollView);
  }

  it('a plain sheet uses BottomSheetView only', async () => {
    markContainers();
    await render(
      <Sheet open onOpenChange={jest.fn()}>
        <Text>내용</Text>
      </Sheet>
    );
    expect(screen.getByTestId('sheet-view')).toContainElement(screen.getByText('내용'));
    expect(screen.queryByTestId('sheet-scroll')).toBeNull();
  });

  it('a menu is one scrollable as the whole sheet content, with no BottomSheetView around it', async () => {
    markContainers();
    await render(
      <MenuSheet
        items={[{ label: '이름 바꾸기', onPress: jest.fn() }]}
        trigger={(open) => (
          <Pressable accessibilityRole="button" accessibilityLabel="목록 메뉴" onPress={open} />
        )}
      />
    );
    await fireEvent.press(screen.getByRole('button', { name: '목록 메뉴' }));
    expect(screen.getAllByTestId('sheet-scroll')).toHaveLength(1);
    expect(screen.queryByTestId('sheet-view')).toBeNull();
    const scroll = screen.getByTestId('sheet-scroll');
    expect(scroll).toContainElement(screen.getByRole('menuitem', { name: '이름 바꾸기' }));
    expect(scroll).toContainElement(screen.getByRole('button', { name: '취소' }));
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
    input.mockRestore();
  });

  /** 라이브러리 입력 칸을 실제 TextInput으로 그리되, 받은 props와 마운트 횟수를 기록하는 목으로 바꾼다. */
  function spyOnSheetTextInput() {
    const mod = jest.requireMock<typeof BottomSheetMock>('@gorhom/bottom-sheet');
    const RealTextInput = mod.BottomSheetTextInput;
    const mounts = { count: 0 };
    const spy = jest
      .spyOn(mod, 'BottomSheetTextInput')
      .mockImplementation(function Recorder(props: React.ComponentProps<typeof RealTextInput>) {
        React.useEffect(() => {
          mounts.count += 1;
        }, []);
        return <RealTextInput {...props} />;
      });
    return { spy, mounts };
  }

  function ControlledSheetInput({ initial, onChange }: { initial: string; onChange?: jest.Mock }) {
    const [value, setValue] = React.useState(initial);
    return (
      <Sheet open onOpenChange={jest.fn()}>
        <SheetInput
          placeholder="목록 이름"
          value={value}
          onChangeText={(text) => {
            onChange?.(text);
            setValue(text);
          }}
        />
        <Pressable accessibilityRole="button" onPress={() => setValue('')}>
          <Text>비우기</Text>
        </Pressable>
      </Sheet>
    );
  }

  it('never passes value to the native input, only defaultValue (iOS Hangul IME breaks otherwise)', async () => {
    const { spy } = spyOnSheetTextInput();
    await render(<ControlledSheetInput initial="우유" />);
    const props = spy.mock.lastCall?.[0];
    expect(props).not.toHaveProperty('value');
    expect(props?.defaultValue).toBe('우유');
  });

  it('typing forwards onChangeText without remounting the native input', async () => {
    const { mounts } = spyOnSheetTextInput();
    const onChange = jest.fn();
    await render(<ControlledSheetInput initial="" onChange={onChange} />);
    expect(mounts.count).toBe(1);
    const before = screen.getByPlaceholderText('목록 이름');
    await fireEvent.changeText(before, '하');
    await fireEvent.changeText(screen.getByPlaceholderText('목록 이름'), '하이');
    expect(onChange.mock.calls).toEqual([['하'], ['하이']]);
    expect(mounts.count).toBe(1);
    expect(screen.getByPlaceholderText('목록 이름')).toBe(before);
  });

  it('an outside value change remounts the native input with the new defaultValue', async () => {
    const { spy, mounts } = spyOnSheetTextInput();
    await render(<ControlledSheetInput initial="" />);
    await fireEvent.changeText(screen.getByPlaceholderText('목록 이름'), '두부');
    expect(mounts.count).toBe(1);
    await fireEvent.press(screen.getByRole('button', { name: '비우기' }));
    expect(mounts.count).toBe(2);
    expect(spy.mock.lastCall?.[0].defaultValue).toBe('');
    expect(spy.mock.lastCall?.[0]).not.toHaveProperty('value');
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

  it('cancel button does nothing after confirm', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    await render(renderConfirm(true, onConfirm, onCancel));
    await fireEvent.press(screen.getByRole('button', { name: '삭제' }));
    await fireEvent.press(screen.getByRole('button', { name: '취소' }));
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

  it('confirm does nothing while a user close animates; the close counts as cancel', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    await render(renderConfirm(true, onConfirm, onCancel));
    const release = holdSheetDismissals();
    await dismissSheetByUser();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await fireEvent.press(screen.getByRole('button', { name: '삭제' }));
    warn.mockRestore();
    expect(onConfirm).not.toHaveBeenCalled();
    await release();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('pressing confirm twice calls onConfirm once', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    await render(renderConfirm(true, onConfirm, onCancel));
    await fireEvent.press(screen.getByRole('button', { name: '삭제' }));
    await fireEvent.press(screen.getByRole('button', { name: '삭제' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('after cancel, neither button does anything until reopened', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const { rerender } = await render(renderConfirm(true, onConfirm, onCancel));
    await fireEvent.press(screen.getByRole('button', { name: '취소' }));
    await fireEvent.press(screen.getByRole('button', { name: '삭제' }));
    await fireEvent.press(screen.getByRole('button', { name: '취소' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    // 다시 열면 다시 답할 수 있다.
    await rerender(renderConfirm(false, onConfirm, onCancel));
    await rerender(renderConfirm(true, onConfirm, onCancel));
    await fireEvent.press(screen.getByRole('button', { name: '삭제' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('unanswered: a reopen during a programmatic close re-presents with no extra callbacks', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const { rerender } = await render(renderConfirm(true, onConfirm, onCancel));
    const release = holdSheetDismissals();
    await rerender(renderConfirm(false, onConfirm, onCancel));
    await rerender(renderConfirm(true, onConfirm, onCancel));
    await release();
    expect(screen.getByRole('header', { name: '목록 삭제' })).toBeTruthy();
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirmed: a reopen during the close resets the answer; a later user dismiss cancels once', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const { rerender } = await render(renderConfirm(true, onConfirm, onCancel));
    const release = holdSheetDismissals();
    await fireEvent.press(screen.getByRole('button', { name: '삭제' }));
    await rerender(renderConfirm(false, onConfirm, onCancel));
    await rerender(renderConfirm(true, onConfirm, onCancel));
    await release();
    expect(screen.getByRole('header', { name: '목록 삭제' })).toBeTruthy();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    await dismissSheetByUser();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
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

  it('a reopen before the close finishes cancels the pending item', async () => {
    const rename = jest.fn();
    await renderMenu([{ label: '이름 바꾸기', onPress: rename }]);
    await openMenu();
    const release = holdSheetDismissals();
    await fireEvent.press(screen.getByRole('menuitem', { name: '이름 바꾸기' }));
    await openMenu();
    await release();
    // 메뉴가 다시 올라왔고, 앞서 누른 항목은 취소됐다(메뉴와 그 항목이 연 시트가 겹치지 않게).
    expect(rename).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: '이름 바꾸기' })).toBeTruthy();
    // 다시 열린 메뉴를 끌어 닫아도 앞서 누른 항목은 부르지 않는다.
    await dismissSheetByUser();
    expect(rename).not.toHaveBeenCalled();
    // 다시 열어 고르면 한 번 부른다.
    await openMenu();
    await fireEvent.press(screen.getByRole('menuitem', { name: '이름 바꾸기' }));
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it('idle: a reopen during the close re-presents and runs no item', async () => {
    const rename = jest.fn();
    await renderMenu([{ label: '이름 바꾸기', onPress: rename }]);
    await openMenu();
    const release = holdSheetDismissals();
    await fireEvent.press(screen.getByRole('button', { name: '취소' }));
    await openMenu();
    await release();
    expect(screen.getByRole('menuitem', { name: '이름 바꾸기' })).toBeTruthy();
    expect(rename).not.toHaveBeenCalled();
  });

  it('idle: unmounting an open menu ignores the late dismiss and runs nothing', async () => {
    const rename = jest.fn();
    const { unmount } = await renderMenu([{ label: '이름 바꾸기', onPress: rename }]);
    await openMenu();
    await unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(rename).not.toHaveBeenCalled();
  });

  it('pending: a user dismiss during the close runs the item once', async () => {
    const rename = jest.fn();
    await renderMenu([{ label: '이름 바꾸기', onPress: rename }]);
    await openMenu();
    const release = holdSheetDismissals();
    await fireEvent.press(screen.getByRole('menuitem', { name: '이름 바꾸기' }));
    // 닫는 도중에 사용자가 끌어 닫아도 새 닫기는 생기지 않는다.
    await dismissSheetByUser();
    await release();
    expect(rename).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menuitem', { name: '이름 바꾸기' })).toBeNull();
    // 메뉴는 닫힌 상태 그대로다(사용자 닫기로 다시 상태가 바뀌지 않는다). 다시 열 수 있다.
    await openMenu();
    expect(screen.getByRole('menuitem', { name: '이름 바꾸기' })).toBeTruthy();
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it('pending: unmounting during the close never runs the item', async () => {
    const rename = jest.fn();
    const { unmount } = await renderMenu([{ label: '이름 바꾸기', onPress: rename }]);
    await openMenu();
    const release = holdSheetDismissals();
    await fireEvent.press(screen.getByRole('menuitem', { name: '이름 바꾸기' }));
    await unmount();
    await release();
    expect(rename).not.toHaveBeenCalled();
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

describe('useLastWhileOpen', () => {
  it('follows the value while open, keeps the last open value while closed, follows again when reopened', async () => {
    const { result, rerender } = await renderHook(
      ({ value, open }: { value: string; open: boolean }) => useLastWhileOpen(value, open),
      { initialProps: { value: 'a', open: true } }
    );
    const steps: [value: string, open: boolean, expected: string][] = [
      ['b', true, 'b'], // 열려 있는 동안 값을 따른다
      ['c', false, 'b'], // 닫는 렌더에서 바뀐 값 대신 마지막으로 열려 있던 때의 값
      ['d', false, 'b'], // 닫혀 있는 동안에도 그대로
      ['e', true, 'e'], // 다시 열리면 새 값
    ];
    expect(result.current).toBe('a');
    for (const [value, open, expected] of steps) {
      await rerender({ value, open });
      expect(result.current).toBe(expected);
    }
  });
});

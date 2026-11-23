import { act, render, screen } from '@testing-library/react-native';
import { BackHandler, Text } from 'react-native';
import { Sheet, SheetInput } from '@/components/ui/sheet';
import { dismissSheetByUser } from '@/test-utils/bottom-sheet';

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
});

// @gorhom/bottom-sheet의 Jest 목(jest.setup.ts가 이 모듈로 대체한다)과 사용자 닫기 helper.
// BottomSheetModal은 present()로 children을 보이고, dismiss()로 숨긴 뒤 onDismiss를 동기로 부른다.
import { act } from '@testing-library/react-native';
import * as React from 'react';
import { TextInput } from 'react-native';

type Entry = { dismiss: () => void; closing: boolean };

// 지금 올라와 있는 모달들(나중에 올라온 것이 뒤). 사용자 닫기 helper가 맨 뒤 것을 닫는다.
const presented: Entry[] = [];
// holdSheetDismissals() 동안은 dismiss()가 닫는 애니메이션이 안 끝난 것처럼 onDismiss를 미뤄 둔다.
let holding = false;
const held: (() => void)[] = [];

function removeEntry(entry: Entry | null) {
  const i = entry ? presented.indexOf(entry) : -1;
  if (i >= 0) presented.splice(i, 1);
}

type ModalProps = { children?: React.ReactNode; onDismiss?: () => void };

export const BottomSheetModal = React.forwardRef<unknown, ModalProps>(
  function BottomSheetModal(props, ref) {
    const [visible, setVisible] = React.useState(false);
    const entry = React.useRef<Entry | null>(null);
    // 미뤄 둔 onDismiss도 그때의 최신 콜백을 부르게 한다.
    const onDismissRef = React.useRef(props.onDismiss);
    React.useLayoutEffect(() => {
      onDismissRef.current = props.onDismiss;
    });
    React.useImperativeHandle(ref, () => {
      const finish = (closing: Entry) => {
        if (entry.current !== closing) return;
        removeEntry(closing);
        entry.current = null;
        setVisible(false);
        onDismissRef.current?.();
      };
      const dismiss = () => {
        const current = entry.current;
        if (!current || current.closing) return;
        current.closing = true;
        if (holding) held.push(() => finish(current));
        else finish(current);
      };
      const noop = () => {};
      return {
        // 닫는 중에 present()가 와도 라이브러리처럼 그 닫기는 끝까지 간다(늦은 onDismiss).
        present: () => {
          if (entry.current) return;
          entry.current = { dismiss: () => dismiss(), closing: false };
          presented.push(entry.current);
          setVisible(true);
        },
        dismiss,
        close: dismiss,
        forceClose: dismiss,
        snapToIndex: noop,
        snapToPosition: noop,
        expand: noop,
        collapse: noop,
      };
    }, []);
    // 라이브러리처럼, 올라와 있던 모달이 언마운트되면 닫고(닫는 애니메이션 뒤) 마지막 onDismiss를 부른다.
    React.useEffect(
      () => () => {
        const current = entry.current;
        removeEntry(current);
        if (!current) return;
        entry.current = null;
        const deliver = () => onDismissRef.current?.();
        if (holding) held.push(deliver);
        else queueMicrotask(deliver);
      },
      []
    );
    return visible ? <>{props.children}</> : null;
  }
);

function Pass({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

export const BottomSheetModalProvider = Pass;
export const BottomSheetView = Pass;
export const BottomSheetTextInput = TextInput;
export const BottomSheetBackdrop = () => null;

/** 맨 위 bottom sheet를 사용자가 끌어 닫거나 배경을 누른 것처럼 닫는다(Sheet의 dismiss()를 거치지 않는다). */
export async function dismissSheetByUser(): Promise<void> {
  const top = presented[presented.length - 1];
  if (!top) throw new Error('올라와 있는 bottom sheet가 없다');
  await act(async () => {
    top.dismiss();
  });
}

/**
 * 이후의 dismiss()가 onDismiss를 바로 부르지 않고 미뤄 두게 한다(닫는 애니메이션 도중을 흉내 낸다).
 * 돌려주는 함수는 미뤄 둔 onDismiss를 차례로 전달하고 미루기를 끝낸다.
 */
export function holdSheetDismissals(): () => Promise<void> {
  holding = true;
  return async () => {
    holding = false;
    await act(async () => {
      for (const deliver of held.splice(0)) deliver();
    });
  };
}

/** 목의 모듈 상태(올라온 모달 목록, 미루기, 미뤄 둔 onDismiss)를 비운다. */
export function resetBottomSheetMock(): void {
  presented.length = 0;
  holding = false;
  held.length = 0;
}

// jest.setup.ts의 afterEach가 이 목을 불러온 테스트 파일에서만 부를 수 있게 등록한다
// (거기서 모듈을 직접 require하면 이 목을 안 쓰는 테스트에서도 testing-library를 테스트 도중에 불러온다).
(globalThis as { __resetBottomSheetMock?: () => void }).__resetBottomSheetMock =
  resetBottomSheetMock;

// @gorhom/bottom-sheet의 Jest 목(jest.setup.ts가 이 모듈로 대체한다)과 사용자 닫기 helper.
// BottomSheetModal은 present()로 children을 보이고, dismiss()로 숨긴 뒤 onDismiss를 동기로 부른다.
import { act } from '@testing-library/react-native';
import * as React from 'react';
import { TextInput } from 'react-native';

type Entry = { dismiss: () => void };

// 지금 올라와 있는 모달들(나중에 올라온 것이 뒤). 사용자 닫기 helper가 맨 뒤 것을 닫는다.
const presented: Entry[] = [];

function removeEntry(entry: Entry | null) {
  const i = entry ? presented.indexOf(entry) : -1;
  if (i >= 0) presented.splice(i, 1);
}

type ModalProps = { children?: React.ReactNode; onDismiss?: () => void };

export const BottomSheetModal = React.forwardRef<unknown, ModalProps>(
  function BottomSheetModal(props, ref) {
    const [visible, setVisible] = React.useState(false);
    const entry = React.useRef<Entry | null>(null);
    // 의존성 없이 매 렌더 갱신해 dismiss가 항상 최신 onDismiss를 부르게 한다.
    React.useImperativeHandle(ref, () => {
      const dismiss = () => {
        if (!entry.current) return;
        removeEntry(entry.current);
        entry.current = null;
        setVisible(false);
        props.onDismiss?.();
      };
      const noop = () => {};
      return {
        present: () => {
          if (entry.current) return;
          entry.current = { dismiss: () => dismiss() };
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
    });
    React.useEffect(() => () => removeEntry(entry.current), []);
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

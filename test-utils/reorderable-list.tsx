// react-native-reorderable-list의 Jest 목(jest.setup.ts가 이 모듈로 대체한다)과 테스트 helper.
//
// 흉내 내는 것: header, data의 각 항목(renderItem), footer를 제자리에 차례로 그린다. useReorderableDrag는
// 그 항목의 index로 "집기"를 기록하고 onDragStart({index})를 부르는 함수를 돌려준다. 놓기는 테스트가
// reorderListItems로 하며, 라이브러리처럼 onDragEnd({from, to})를 먼저 부르고 자리가 바뀌었을 때만 onReorder를 부른다.
// 흉내 내지 않는 것: 제스처, 끄는 동안의 애니메이션·자동 스크롤, FlatList 가상화, onIndexChange.
import { act } from '@testing-library/react-native';
import * as React from 'react';
import { View } from 'react-native';

type ReorderEvent = { from: number; to: number };
type Props = {
  onDragStart?: (e: { index: number }) => void;
  onDragEnd?: (e: ReorderEvent) => void;
  data: readonly unknown[];
  renderItem: (info: { item: any; index: number }) => React.ReactNode;
  keyExtractor?: (item: any, index: number) => string;
  onReorder: (e: ReorderEvent) => void;
  ListHeaderComponent?: React.ComponentType | React.ReactElement | null;
  ListFooterComponent?: React.ComponentType | React.ReactElement | null;
};

let latest: Props | null = null;
let dragged: number[] = [];

const CellIndex = React.createContext<number>(-1);

function renderSlot(slot: Props['ListHeaderComponent']) {
  if (!slot) return null;
  if (React.isValidElement(slot)) return slot;
  const C = slot as React.ComponentType;
  return <C />;
}

function ReorderableList(props: Props) {
  React.useLayoutEffect(() => {
    latest = props;
  });
  return (
    <View>
      {renderSlot(props.ListHeaderComponent)}
      {props.data.map((item, index) => (
        <CellIndex.Provider key={props.keyExtractor?.(item, index) ?? index} value={index}>
          {props.renderItem({ item, index })}
        </CellIndex.Provider>
      ))}
      {renderSlot(props.ListFooterComponent)}
    </View>
  );
}

export default ReorderableList;

export function useReorderableDrag() {
  const index = React.useContext(CellIndex);
  if (index < 0) throw new Error('useReorderableDrag는 목록 항목 안에서만 쓸 수 있다');
  return () => {
    dragged.push(index);
    latest?.onDragStart?.({ index });
  };
}

/** 마지막으로 그린 ReorderableList의 data(끌 수 있는 항목들). */
export function reorderableData(): readonly unknown[] {
  if (!latest) throw new Error('그려진 ReorderableList가 없다');
  return latest.data;
}

/** 사용자가 from 자리의 항목을 끌어 to 자리에 놓은 것처럼 onDragEnd, (자리가 바뀌었으면) onReorder 순서로 부른다. */
export async function reorderListItems(from: number, to: number): Promise<void> {
  if (!latest) throw new Error('그려진 ReorderableList가 없다');
  await act(async () => {
    latest!.onDragEnd?.({ from, to });
  });
  if (from === to) return;
  await act(async () => {
    latest!.onReorder({ from, to });
  });
}

/** 집기(useReorderableDrag가 돌려준 함수)가 불린 항목 index들. */
export function draggedIndexes(): number[] {
  return dragged;
}

export function resetReorderableListMock(): void {
  latest = null;
  dragged = [];
}

(globalThis as { __resetReorderableListMock?: () => void }).__resetReorderableListMock =
  resetReorderableListMock;

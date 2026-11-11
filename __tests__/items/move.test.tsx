import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PortalHost } from '@rn-primitives/portal';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { BackHandler } from 'react-native';
import type { ReactElement } from 'react';
import ListDetail from '@/app/(app)/list/[id]/index';
import { fetchMyFamilies, fetchFamilyMembers, type Family } from '@/src/groups/group-api';
import { resetCurrentGroupStore } from '@/src/groups/current-group-store';
import { deleteItems, fetchItems, moveItems, updateItem, type Item } from '@/src/items/item-api';
import { fetchLists, type List } from '@/src/lists/list-api';
import { createQueryClient } from '@/src/lib/query-client';
import { qk } from '@/src/lib/query-keys';
import { disposeClient } from '@/test-utils/dispose-client';

// 제스처는 시뮬레이션하지 않는다. 오른쪽 액션을 항상 그린다(비활성이면 renderRightActions가 없다).
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ children, renderRightActions }: any) => (
      <View>
        {children}
        {renderRightActions?.()}
      </View>
    ),
  };
});

let mockParams: { id: string } = { id: 'l1' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/src/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/src/lib/toast', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/src/groups/group-api', () => ({
  fetchMyFamilies: jest.fn(),
  fetchFamilyMembers: jest.fn(),
  renameFamily: jest.fn(),
  createFamily: jest.fn(),
}));
jest.mock('@/src/lists/list-api', () => ({
  fetchLists: jest.fn(),
  insertList: jest.fn(),
  renameList: jest.fn(),
  deleteList: jest.fn(),
}));
jest.mock('@/src/items/item-api', () => ({
  fetchItems: jest.fn(),
  insertItem: jest.fn(),
  updateItem: jest.fn(),
  deleteItems: jest.fn(),
  clearDoneItems: jest.fn(),
  clearListItems: jest.fn(),
  moveItems: jest.fn(),
}));

const G1: Family = {
  id: 'g1',
  name: '우리집',
  invite_code: '123456',
  created_at: '2026-01-01T00:00:00Z',
  created_by: 'u1',
};
const list = (o: Partial<List> & Pick<List, 'id' | 'name'>): List => ({
  family_id: 'g1',
  kind: 'store',
  sort_order: 0,
  created_at: '2026-01-01T00:00:00Z',
  ...o,
});
const item = (o: Partial<Item> & Pick<Item, 'id' | 'name'>): Item => ({
  list_id: 'l1',
  family_id: 'g1',
  note: null,
  is_done: false,
  done_at: null,
  sort_order: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  created_by: 'u1',
  ...o,
});

const lists = fetchLists as jest.Mock;
const items = fetchItems as jest.Mock;

let client: QueryClient;
const tree = (ui: ReactElement) => (
  <QueryClientProvider client={client}>
    {ui}
    <PortalHost />
  </QueryClientProvider>
);
const renderWithClient = (ui: ReactElement) => render(tree(ui));

async function longPress(name: string) {
  await fireEvent(await screen.findByText(name), 'longPress');
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetCurrentGroupStore();
  onlineManager.setOnline(true);
  mockParams = { id: 'l1' };
  client = createQueryClient();
  (fetchMyFamilies as jest.Mock).mockResolvedValue([G1]);
  (fetchFamilyMembers as jest.Mock).mockResolvedValue([{}]);
  lists.mockResolvedValue([
    list({ id: 'inbox', name: '사야할것', kind: 'inbox' }),
    list({ id: 'l1', name: '이마트' }),
    list({ id: 'l2', name: '쿠팡', kind: 'online' }),
  ]);
  items.mockResolvedValue([
    item({ id: 'i1', name: '우유' }),
    item({ id: 'i2', name: '빵' }),
    item({ id: 'i3', name: '계란', is_done: true, done_at: '2026-01-02T00:00:00Z' }),
  ]);
});
afterEach(async () => {
  await cleanup();
  disposeClient(client);
});

describe('selection mode', () => {
  it('starts on long press, shows the count and toggles other rows by tapping', async () => {
    await renderWithClient(<ListDetail />);
    await longPress('우유');
    expect(await screen.findByText('1개 선택됨')).toBeTruthy();
    await fireEvent.press(screen.getByText('빵'));
    expect(await screen.findByText('2개 선택됨')).toBeTruthy();
    // 선택 모드의 탭은 편집 시트를 열지 않는다.
    expect(screen.queryByPlaceholderText('항목 이름')).toBeNull();
    await fireEvent.press(screen.getByText('빵'));
    expect(await screen.findByText('1개 선택됨')).toBeTruthy();
  });

  it('ends when the last item is deselected', async () => {
    await renderWithClient(<ListDetail />);
    await longPress('우유');
    await fireEvent.press(await screen.findByText('우유'));
    await waitFor(() => expect(screen.queryByText(/개 선택됨/)).toBeNull());
    expect(screen.getByText('이마트')).toBeTruthy();
    // 평소처럼 탭하면 편집 시트가 열린다.
    await fireEvent.press(screen.getByText('우유'));
    expect(await screen.findByPlaceholderText('항목 이름')).toBeTruthy();
  });

  it('adds to the selection on another long press instead of restarting it', async () => {
    await renderWithClient(<ListDetail />);
    await longPress('우유');
    await screen.findByText('1개 선택됨');
    await longPress('빵');
    expect(await screen.findByText('2개 선택됨')).toBeTruthy();
  });

  it('ends selection mode on the hardware back button', async () => {
    let handler: (() => boolean) | undefined;
    // RN 목의 addEventListener는 jest.fn이라 mockRestore 대신 한 번만 바꾼다.
    jest.spyOn(BackHandler, 'addEventListener').mockImplementationOnce((_, h) => {
      handler = h as () => boolean;
      return { remove: jest.fn() };
    });
    await renderWithClient(<ListDetail />);
    await longPress('우유');
    await screen.findByText('1개 선택됨');
    let handled: boolean | undefined;
    await act(async () => {
      handled = handler?.();
    });
    expect(handled).toBe(true);
    await waitFor(() => expect(screen.queryByText(/개 선택됨/)).toBeNull());
  });

  it('can select finished items too', async () => {
    await renderWithClient(<ListDetail />);
    await longPress('계란');
    expect(await screen.findByText('1개 선택됨')).toBeTruthy();
  });

  it('disables the checkbox and the swipe delete while selecting', async () => {
    await renderWithClient(<ListDetail />);
    await longPress('우유');
    await screen.findByText('1개 선택됨');
    expect(screen.getByRole('checkbox', { name: '우유 완료' })).toBeDisabled();
    expect(screen.queryAllByRole('button', { name: '삭제' })).toHaveLength(0);
    expect(updateItem).not.toHaveBeenCalled();
  });

  it('clears the selection with 취소', async () => {
    await renderWithClient(<ListDetail />);
    await longPress('우유');
    await fireEvent.press(await screen.findByRole('button', { name: '선택 취소' }));
    await waitFor(() => expect(screen.queryByText(/개 선택됨/)).toBeNull());
  });

  it('drops an item that disappears while selected', async () => {
    await renderWithClient(<ListDetail />);
    await longPress('우유');
    await fireEvent.press(await screen.findByText('빵'));
    await screen.findByText('2개 선택됨');
    items.mockResolvedValue([item({ id: 'i2', name: '빵' })]);
    await client.invalidateQueries({ queryKey: qk.items('l1') });
    expect(await screen.findByText('1개 선택됨')).toBeTruthy();
  });

  it('resets when the list changes', async () => {
    const view = await renderWithClient(<ListDetail />);
    await longPress('우유');
    await screen.findByText('1개 선택됨');
    mockParams = { id: 'l2' };
    items.mockResolvedValue([]);
    await view.rerender(tree(<ListDetail />));
    await waitFor(() => expect(screen.queryByText(/개 선택됨/)).toBeNull());
    expect(await screen.findByText('쿠팡')).toBeTruthy();
  });
});

describe('move', () => {
  it('offers the other lists of the group, excluding the current one', async () => {
    await renderWithClient(<ListDetail />);
    await longPress('우유');
    await fireEvent.press(await screen.findByRole('button', { name: '선택 항목 이동' }));
    expect(await screen.findByRole('button', { name: '사야할것' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '쿠팡' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '이마트' })).toBeNull();
  });

  it('moves the selected items to the chosen list and leaves selection mode', async () => {
    await renderWithClient(<ListDetail />);
    await longPress('우유');
    await fireEvent.press(await screen.findByText('계란'));
    await fireEvent.press(await screen.findByRole('button', { name: '선택 항목 이동' }));
    await fireEvent.press(await screen.findByRole('button', { name: '쿠팡' }));
    await waitFor(() => expect(moveItems).toHaveBeenCalledWith('l2', ['i1', 'i3']));
    await waitFor(() => expect(screen.queryByText(/개 선택됨/)).toBeNull());
    expect(screen.queryByRole('button', { name: '쿠팡' })).toBeNull();
  });

  it('says so when there is no other list to move to', async () => {
    lists.mockResolvedValue([list({ id: 'l1', name: '이마트' })]);
    await renderWithClient(<ListDetail />);
    await longPress('우유');
    await fireEvent.press(await screen.findByRole('button', { name: '선택 항목 이동' }));
    expect(await screen.findByText('이동할 수 있는 목록이 없어요')).toBeTruthy();
  });

  it('closes the move sheet when the selected items disappear', async () => {
    await renderWithClient(<ListDetail />);
    await longPress('우유');
    await fireEvent.press(await screen.findByRole('button', { name: '선택 항목 이동' }));
    expect(await screen.findByRole('button', { name: '쿠팡' })).toBeTruthy();
    items.mockResolvedValue([item({ id: 'i2', name: '빵' })]);
    await client.invalidateQueries({ queryKey: qk.items('l1') });
    await waitFor(() => expect(screen.queryByRole('button', { name: '쿠팡' })).toBeNull());
    expect(moveItems).not.toHaveBeenCalled();
  });

  it('moves from the inbox to other lists without offering itself', async () => {
    mockParams = { id: 'inbox' };
    items.mockResolvedValue([item({ id: 'i1', name: '우유', list_id: 'inbox' })]);
    await renderWithClient(<ListDetail />);
    await longPress('우유');
    await fireEvent.press(await screen.findByRole('button', { name: '선택 항목 이동' }));
    expect(await screen.findByRole('button', { name: '이마트' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '사야할것' })).toBeNull();
  });
});

describe('delete selected', () => {
  it('deletes only after confirming, then leaves selection mode', async () => {
    await renderWithClient(<ListDetail />);
    await longPress('우유');
    await fireEvent.press(await screen.findByText('빵'));
    await fireEvent.press(await screen.findByRole('button', { name: '선택 항목 삭제' }));
    expect(await screen.findByText('2개 항목을 삭제할까요?')).toBeTruthy();
    expect(deleteItems).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(deleteItems).toHaveBeenCalledWith(['i1', 'i2']));
    await waitFor(() => expect(screen.queryByText(/개 선택됨/)).toBeNull());
  });

  it('closes the confirmation when the selected items disappear', async () => {
    await renderWithClient(<ListDetail />);
    await longPress('우유');
    await fireEvent.press(await screen.findByRole('button', { name: '선택 항목 삭제' }));
    expect(await screen.findByText('1개 항목을 삭제할까요?')).toBeTruthy();
    items.mockResolvedValue([item({ id: 'i2', name: '빵' })]);
    await client.invalidateQueries({ queryKey: qk.items('l1') });
    await waitFor(() => expect(screen.queryByText(/개 항목을 삭제할까요/)).toBeNull());
    expect(deleteItems).not.toHaveBeenCalled();
  });

  it('keeps the selection when the confirmation is cancelled', async () => {
    await renderWithClient(<ListDetail />);
    await longPress('우유');
    await fireEvent.press(await screen.findByRole('button', { name: '선택 항목 삭제' }));
    await fireEvent.press(await screen.findByRole('button', { name: '취소' }));
    await waitFor(() => expect(screen.queryByText('1개 항목을 삭제할까요?')).toBeNull());
    expect(deleteItems).not.toHaveBeenCalled();
    expect(screen.getByText('1개 선택됨')).toBeTruthy();
  });
});

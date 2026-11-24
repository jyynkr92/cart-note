import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import ListDetail from '@/app/(app)/list/[id]/index';
import { fetchMyFamilies, fetchFamilyMembers, type Family } from '@/src/groups/group-api';
import { resetCurrentGroupStore } from '@/src/groups/current-group-store';
import {
  clearDoneItems,
  clearListItems,
  deleteItems,
  fetchItems,
  insertItem,
  updateItem,
  type Item,
} from '@/src/items/item-api';
import { deleteList, fetchLists, renameList, type List } from '@/src/lists/list-api';
import { createQueryClient } from '@/src/lib/query-client';
import { disposeClient } from '@/test-utils/dispose-client';

// 제스처 자체는 시뮬레이션하지 않는다. 오른쪽 액션을 항상 그려서 접근 가능한 버튼으로 누른다.
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

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockParams: { id: string } = { id: 'l1' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
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
  invite_code: '12345678',
  invite_code_expires_at: '2099-01-01T00:00:00Z',
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
const renderWithClient = (ui: ReactElement) =>
  render(
    <QueryClientProvider client={client}>
      {ui}
    </QueryClientProvider>
  );

async function openMenu() {
  await fireEvent.press(await screen.findByRole('button', { name: '목록 메뉴' }));
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
  lists.mockResolvedValue([list({ id: 'l1', name: '이마트' })]);
  items.mockResolvedValue([]);
});
afterEach(async () => {
  await cleanup();
  disposeClient(client);
});

describe('add item', () => {
  it('adds on submit, clears the input and keeps it ready for the next entry', async () => {
    await renderWithClient(<ListDetail />);
    const input = await screen.findByPlaceholderText('항목 추가');
    await fireEvent.changeText(input, ' 우유 ');
    await fireEvent(input, 'submitEditing');
    await waitFor(() =>
      expect(insertItem).toHaveBeenCalledWith(
        expect.objectContaining({ listId: 'l1', familyId: 'g1', name: '우유' })
      )
    );
    expect(screen.getByPlaceholderText('항목 추가').props.value).toBe('');
    expect(screen.getByPlaceholderText('항목 추가').props.submitBehavior).toBe('submit');
    // DB CHECK(0008)와 같은 길이 제한(A13)
    expect(screen.getByPlaceholderText('항목 추가').props.maxLength).toBe(200);
  });

  it('ignores a whitespace-only entry', async () => {
    await renderWithClient(<ListDetail />);
    const input = await screen.findByPlaceholderText('항목 추가');
    await fireEvent.changeText(input, '   ');
    await fireEvent(input, 'submitEditing');
    expect(insertItem).not.toHaveBeenCalled();
  });
});

describe('items', () => {
  it('toggles an item with its checkbox', async () => {
    items.mockResolvedValue([item({ id: 'i1', name: '우유' })]);
    await renderWithClient(<ListDetail />);
    await fireEvent.press(await screen.findByRole('checkbox', { name: '우유 완료' }));
    await waitFor(() =>
      expect(updateItem).toHaveBeenCalledWith('i1', {
        is_done: true,
        done_at: expect.any(String),
      })
    );
  });

  it('shows finished items under a counted "완료됨" section, most recent first', async () => {
    items.mockResolvedValue([
      item({ id: 'i1', name: '우유' }),
      item({ id: 'i2', name: '빵', is_done: true, done_at: '2026-01-02T00:00:00Z' }),
      item({ id: 'i3', name: '계란', is_done: true, done_at: '2026-01-03T00:00:00Z' }),
    ]);
    await renderWithClient(<ListDetail />);
    expect(await screen.findByText('완료됨 (2)')).toBeTruthy();
    const names = screen.getAllByTestId('item-name').map((n) => n.props.children);
    expect(names).toEqual(['우유', '계란', '빵']);
  });

  it('deletes through the swipe action', async () => {
    items.mockResolvedValue([item({ id: 'i1', name: '우유' })]);
    await renderWithClient(<ListDetail />);
    await fireEvent.press(await screen.findByRole('button', { name: '삭제' }));
    await waitFor(() => expect(deleteItems).toHaveBeenCalledWith(['i1']));
  });

  it('edits the name and note from the edit sheet', async () => {
    items.mockResolvedValue([item({ id: 'i1', name: '우유' })]);
    await renderWithClient(<ListDetail />);
    await fireEvent.press(await screen.findByText('우유'));
    const name = await screen.findByPlaceholderText('항목 이름');
    expect(name.props.value).toBe('우유');
    expect(name.props.maxLength).toBe(200);
    expect(screen.getByPlaceholderText('메모').props.maxLength).toBe(1000);
    await fireEvent.changeText(name, ' 두유 ');
    await fireEvent.changeText(screen.getByPlaceholderText('메모'), ' 무가당 ');
    await fireEvent.press(screen.getByRole('button', { name: '저장' }));
    await waitFor(() =>
      expect(updateItem).toHaveBeenCalledWith('i1', { name: '두유', note: '무가당' })
    );
  });

  it('does not save an item whose name is only whitespace', async () => {
    items.mockResolvedValue([item({ id: 'i1', name: '우유' })]);
    await renderWithClient(<ListDetail />);
    await fireEvent.press(await screen.findByText('우유'));
    await fireEvent.changeText(await screen.findByPlaceholderText('항목 이름'), '   ');
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
    expect(updateItem).not.toHaveBeenCalled();
  });
});

describe('menu', () => {
  it('clears finished items', async () => {
    items.mockResolvedValue([
      item({ id: 'i2', name: '빵', is_done: true, done_at: '2026-01-02T00:00:00Z' }),
    ]);
    await renderWithClient(<ListDetail />);
    await screen.findByText('빵');
    await openMenu();
    await fireEvent.press(await screen.findByText('완료 항목 지우기'));
    await waitFor(() => expect(clearDoneItems).toHaveBeenCalledWith('l1', ['i2']));
  });

  it('disables "완료 항목 지우기" when nothing is finished', async () => {
    items.mockResolvedValue([item({ id: 'i1', name: '우유' })]);
    await renderWithClient(<ListDetail />);
    await screen.findByText('우유');
    await openMenu();
    expect(await screen.findByRole('menuitem', { name: '완료 항목 지우기' })).toBeDisabled();
  });

  it('disables "목록 비우기" until the items are loaded (B12)', async () => {
    items.mockReturnValue(new Promise(() => {}));
    await renderWithClient(<ListDetail />);
    await openMenu();
    expect(await screen.findByRole('menuitem', { name: '목록 비우기' })).toBeDisabled();
  });

  it('disables "목록 비우기" for an empty list (B12)', async () => {
    items.mockResolvedValue([]);
    await renderWithClient(<ListDetail />);
    await waitFor(() => expect(items).toHaveBeenCalled());
    await openMenu();
    await waitFor(async () =>
      expect(await screen.findByRole('menuitem', { name: '목록 비우기' })).toBeDisabled()
    );
  });

  it('empties the list only after confirming', async () => {
    items.mockResolvedValue([item({ id: 'i1', name: '우유' })]);
    await renderWithClient(<ListDetail />);
    await screen.findByText('우유');
    await openMenu();
    await fireEvent.press(await screen.findByText('목록 비우기'));
    expect(await screen.findByText('목록의 모든 항목을 삭제할까요?')).toBeTruthy();
    expect(clearListItems).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('비우기'));
    await waitFor(() => expect(clearListItems).toHaveBeenCalledWith('l1', ['i1']));
  });

  it('does not empty the list when cancelled', async () => {
    items.mockResolvedValue([item({ id: 'i1', name: '우유' })]);
    await renderWithClient(<ListDetail />);
    await screen.findByText('우유');
    await openMenu();
    await fireEvent.press(await screen.findByText('목록 비우기'));
    await fireEvent.press(await screen.findByText('취소'));
    await waitFor(() => expect(screen.queryByText('목록의 모든 항목을 삭제할까요?')).toBeNull());
    expect(clearListItems).not.toHaveBeenCalled();
  });

  it('hides list deletion and location management for the inbox', async () => {
    lists.mockResolvedValue([list({ id: 'l1', name: '사야할것', kind: 'inbox' })]);
    await renderWithClient(<ListDetail />);
    await openMenu();
    expect(await screen.findByText('목록 비우기')).toBeTruthy();
    expect(screen.queryByText('목록 삭제')).toBeNull();
    expect(screen.queryByText('지점 관리')).toBeNull();
  });

  it('hides location management for an online list', async () => {
    lists.mockResolvedValue([list({ id: 'l1', name: '쿠팡', kind: 'online' })]);
    await renderWithClient(<ListDetail />);
    await openMenu();
    expect(await screen.findByText('목록 삭제')).toBeTruthy();
    expect(screen.queryByText('지점 관리')).toBeNull();
  });

  it('offers location management on a store list and navigates to it', async () => {
    await renderWithClient(<ListDetail />);
    await openMenu();
    await fireEvent.press(await screen.findByText('지점 관리'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/list/[id]/locations',
      params: { id: 'l1' },
    });
  });

  it('deletes a store list after confirming and goes home', async () => {
    await renderWithClient(<ListDetail />);
    await openMenu();
    await fireEvent.press(await screen.findByText('목록 삭제'));
    expect(deleteList).not.toHaveBeenCalled();
    await fireEvent.press(await screen.findByRole('button', { name: '삭제' }));
    await waitFor(() => expect(deleteList).toHaveBeenCalledWith('l1'));
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('does not flash the not-found state while deleting, nor refetch items', async () => {
    await renderWithClient(<ListDetail />);
    await waitFor(() => expect(items).toHaveBeenCalledTimes(1));
    // 서버에서도 삭제됐으므로 이후 재조회는 목록을 돌려주지 않는다.
    (deleteList as jest.Mock).mockImplementationOnce(async () => lists.mockResolvedValue([]));
    await openMenu();
    await fireEvent.press(await screen.findByText('목록 삭제'));
    await fireEvent.press(await screen.findByRole('button', { name: '삭제' }));
    await waitFor(() => expect(deleteList).toHaveBeenCalledWith('l1'));
    expect(screen.queryByText('목록을 찾을 수 없어요')).toBeNull();
    expect(items).toHaveBeenCalledTimes(1);
  });

  it('does not delete the list when the confirmation is cancelled', async () => {
    await renderWithClient(<ListDetail />);
    await openMenu();
    await fireEvent.press(await screen.findByText('목록 삭제'));
    await fireEvent.press(await screen.findByText('취소'));
    expect(deleteList).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('renames the list and blocks a whitespace-only name', async () => {
    await renderWithClient(<ListDetail />);
    await openMenu();
    await fireEvent.press(await screen.findByText('이름 변경'));
    const input = await screen.findByPlaceholderText('목록 이름');
    expect(input.props.value).toBe('이마트');
    expect(input.props.maxLength).toBe(50);
    await fireEvent.changeText(input, '   ');
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
    expect(renameList).not.toHaveBeenCalled();
    await fireEvent.changeText(input, ' 코스트코 ');
    await fireEvent.press(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(renameList).toHaveBeenCalledWith('l1', '코스트코'));
  });
});

describe('unusual states', () => {
  it('shows an offline state instead of a spinner when paused with no data', async () => {
    client.setQueryData(['families'], [G1]);
    onlineManager.setOnline(false);
    await renderWithClient(<ListDetail />);
    expect(await screen.findByText('오프라인이라 불러올 수 없어요')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull();
  });

  it('shows a not-found state with a way home when the list is not in the group', async () => {
    mockParams = { id: 'gone' };
    await renderWithClient(<ListDetail />);
    expect(await screen.findByText('목록을 찾을 수 없어요')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '홈으로' }));
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(items).not.toHaveBeenCalled();
  });

  it('shows an error state with retry when loading failed and there is no data', async () => {
    client.setDefaultOptions({ queries: { retry: false } });
    items.mockRejectedValueOnce(new Error('network'));
    await renderWithClient(<ListDetail />);
    await fireEvent.press(await screen.findByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(items).toHaveBeenCalledTimes(2));
  });
});

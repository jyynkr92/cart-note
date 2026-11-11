import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PortalHost } from '@rn-primitives/portal';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import AppLayout from '@/app/(app)/_layout';
import Home from '@/app/(app)/index';
import { fetchFamilyMembers, fetchMyFamilies, renameFamily, type Family } from '@/src/groups/group-api';
import { resetCurrentGroupStore } from '@/src/groups/current-group-store';
import { fetchLists, insertList, type List } from '@/src/lists/list-api';
import { createQueryClient } from '@/src/lib/query-client';
import { disposeClient } from '@/test-utils/dispose-client';

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  return {
    useRouter: () => ({ push: mockPush }),
    Redirect: () => null,
    Stack: () => <Text>STACK</Text>,
  };
});
jest.mock('@/src/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/src/lib/toast', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/src/items/item-api', () => ({}));
jest.mock('@/src/auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false }),
}));
jest.mock('@/src/onboarding/use-onboarding', () => ({
  useOnboarding: () => ({ step: 'ready', pendingInvite: null, error: false, retry: jest.fn() }),
}));
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

const fam = (id: string, name: string, created_at: string): Family => ({
  id,
  name,
  invite_code: '123456',
  created_at,
  created_by: 'u1',
});
const G1 = fam('g1', '우리집', '2026-01-01T00:00:00Z');
const G2 = fam('g2', '회사', '2026-02-01T00:00:00Z');
const list = (o: Partial<List> & Pick<List, 'id' | 'name'>): List => ({
  family_id: 'g1',
  kind: 'store',
  sort_order: 0,
  created_at: '2026-01-01T00:00:00Z',
  ...o,
});

const families = fetchMyFamilies as jest.Mock;
const members = fetchFamilyMembers as jest.Mock;
const lists = fetchLists as jest.Mock;

let client: QueryClient;
const renderWithClient = (ui: ReactElement) =>
  render(
    <QueryClientProvider client={client}>
      {ui}
      <PortalHost />
    </QueryClientProvider>
  );

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetCurrentGroupStore();
  onlineManager.setOnline(true);
  client = createQueryClient();
  families.mockResolvedValue([G1]);
  members.mockResolvedValue([{}, {}]);
  lists.mockResolvedValue([]);
});
afterEach(async () => {
  await cleanup();
  disposeClient(client);
});

it('shows the inbox first, then lists by sort_order, with counts and the location marker', async () => {
  lists.mockResolvedValue([
    list({ id: 'l2', name: '이마트', sort_order: 2, unfinished_count: 3, has_location: true }),
    list({ id: 'l3', name: '쿠팡', kind: 'online', sort_order: 1, unfinished_count: 0 }),
    list({ id: 'l1', name: '사야할것', kind: 'inbox', sort_order: 9, unfinished_count: 5 }),
  ]);
  await renderWithClient(<Home />);
  await screen.findByText('이마트');
  const names = screen
    .getAllByTestId('list-card-name')
    .map((n) => n.props.children);
  expect(names).toEqual(['사야할것', '쿠팡', '이마트']);
  expect(screen.getByText('3개 남음')).toBeTruthy();
  expect(screen.getByText('5개 남음')).toBeTruthy();
  expect(screen.getAllByText('📍')).toHaveLength(1);
});

it('navigates to the list when a card is pressed', async () => {
  lists.mockResolvedValue([list({ id: 'l2', name: '이마트' })]);
  await renderWithClient(<Home />);
  await fireEvent.press(await screen.findByText('이마트'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/list/[id]', params: { id: 'l2' } });
});

it('does not crash and shows no lists when there are no groups', async () => {
  families.mockResolvedValue([]);
  await renderWithClient(<Home />);
  await waitFor(() => expect(families).toHaveBeenCalled());
  expect(lists).not.toHaveBeenCalled();
  expect(screen.queryByText('+ 목록 추가')).toBeNull();
});

describe('group switcher', () => {
  it('shows a plain name without a menu when there is one group', async () => {
    await renderWithClient(<Home />);
    expect(await screen.findByText('우리집')).toBeTruthy();
    expect(screen.queryByText('우리집 ▾')).toBeNull();
  });

  it('offers the group list, rename, new group and join-by-code with 2+ groups', async () => {
    families.mockResolvedValue([G1, G2]);
    await renderWithClient(<Home />);
    await fireEvent.press(await screen.findByText('우리집 ▾'));
    expect(await screen.findByText('회사')).toBeTruthy();
    expect(screen.getByText('이름 변경')).toBeTruthy();
    expect(screen.getByText('+ 새 그룹')).toBeTruthy();
    expect(screen.getByText('코드로 참여')).toBeTruthy();
  });

  it('switches the group and persists the choice', async () => {
    families.mockResolvedValue([G1, G2]);
    await renderWithClient(<Home />);
    await fireEvent.press(await screen.findByText('우리집 ▾'));
    await fireEvent.press(await screen.findByText('회사'));
    expect(await screen.findByText('회사 ▾')).toBeTruthy();
    await waitFor(async () => expect(await AsyncStorage.getItem('cart-note-current-group')).toBe('g2'));
  });

  it('navigates to the join screen', async () => {
    families.mockResolvedValue([G1, G2]);
    await renderWithClient(<Home />);
    await fireEvent.press(await screen.findByText('우리집 ▾'));
    await fireEvent.press(await screen.findByText('코드로 참여'));
    expect(mockPush).toHaveBeenCalledWith('/join');
  });

  it('renames through a dialog and blocks a whitespace-only name', async () => {
    families.mockResolvedValue([G1, G2]);
    (renameFamily as jest.Mock).mockResolvedValue(undefined);
    await renderWithClient(<Home />);
    await fireEvent.press(await screen.findByText('우리집 ▾'));
    await fireEvent.press(await screen.findByText('이름 변경'));
    const input = await screen.findByPlaceholderText('그룹 이름');
    await fireEvent.changeText(input, '   ');
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
    expect(renameFamily).not.toHaveBeenCalled();
    await fireEvent.changeText(input, ' 새 이름 ');
    await fireEvent.press(screen.getByText('저장'));
    await waitFor(() => expect(renameFamily).toHaveBeenCalledWith('g1', '새 이름'));
    await waitFor(() => expect(families).toHaveBeenCalledTimes(2)); // families 무효화 → 재조회
  });
});

it('shows the invite hint when the group has one member', async () => {
  members.mockResolvedValue([{}]);
  await renderWithClient(<Home />);
  expect(await screen.findByText(/가족을 초대/)).toBeTruthy();
});

it('hides the invite hint with 2+ members', async () => {
  await renderWithClient(<Home />);
  await screen.findByText('우리집');
  await waitFor(() => expect(members).toHaveBeenCalled());
  expect(screen.queryByText(/가족을 초대/)).toBeNull();
});

describe('add list', () => {
  it('disables saving for a whitespace-only name and defaults the kind to store', async () => {
    await renderWithClient(<Home />);
    await fireEvent.press(await screen.findByText('+ 목록 추가'));
    const input = await screen.findByPlaceholderText('목록 이름');
    await fireEvent.changeText(input, '   ');
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
    expect(insertList).not.toHaveBeenCalled();

    await fireEvent.changeText(input, ' 코스트코 ');
    await fireEvent.press(screen.getByText('저장'));
    await waitFor(() =>
      expect(insertList).toHaveBeenCalledWith(
        expect.objectContaining({ familyId: 'g1', name: '코스트코', kind: 'store' })
      )
    );
  });

  it('can create an online list', async () => {
    await renderWithClient(<Home />);
    await fireEvent.press(await screen.findByText('+ 목록 추가'));
    await fireEvent.press(await screen.findByText('사이트'));
    await fireEvent.changeText(await screen.findByPlaceholderText('목록 이름'), '쿠팡');
    await fireEvent.press(screen.getByText('저장'));
    await waitFor(() =>
      expect(insertList).toHaveBeenCalledWith(expect.objectContaining({ name: '쿠팡', kind: 'online' }))
    );
  });
});

describe('load error', () => {
  it('shows a retry state when the lists failed to load and retries on press', async () => {
    client.setDefaultOptions({ queries: { retry: false } });
    lists.mockRejectedValueOnce(new Error('network'));
    await renderWithClient(<Home />);
    await fireEvent.press(await screen.findByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(lists).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('다시 시도')).toBeNull());
  });
});

describe('offline banner', () => {
  it('shows while offline and disappears when back online', async () => {
    families.mockResolvedValue([G1]);
    await renderWithClient(<AppLayout />);
    expect(screen.queryByText('오프라인')).toBeNull();
    await act(async () => onlineManager.setOnline(false));
    expect(await screen.findByText('오프라인')).toBeTruthy();
    await act(async () => onlineManager.setOnline(true));
    await waitFor(() => expect(screen.queryByText('오프라인')).toBeNull());
  });
});

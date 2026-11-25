import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Keyboard } from 'react-native';
import AppLayout from '@/app/(app)/_layout';
import Home from '@/app/(app)/index';
import {
  fetchFamilyMembers,
  fetchMyFamilies,
  renameFamily,
  type Family,
} from '@/src/groups/group-api';
import { resetCurrentGroupStore } from '@/src/groups/current-group-store';
import { fetchLists, insertList, reorderLists, type List } from '@/src/lists/list-api';
import { createQueryClient } from '@/src/lib/query-client';
import { toast } from '@/src/lib/toast';
import { disposeClient } from '@/test-utils/dispose-client';
import { draggedIndexes, reorderableData, reorderListItems } from '@/test-utils/reorderable-list';

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
jest.mock('@/src/realtime/use-family-realtime', () => ({ useFamilyRealtime: jest.fn() }));
let mockAuth: { session: unknown; loading: boolean; offlineUserId: string | null } = {
  session: { user: { id: 'u1' } },
  loading: false,
  offlineUserId: null,
};
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
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
  reorderLists: jest.fn(),
}));

const fam = (id: string, name: string, created_at: string): Family => ({
  id,
  name,
  invite_code: '12345678',
  invite_code_expires_at: '2099-01-01T00:00:00Z',
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
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);

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
  const names = screen.getAllByTestId('list-card-name').map((n) => n.props.children);
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

describe('reordering', () => {
  const three = () => [
    list({ id: 'l0', name: '사야할것', kind: 'inbox', sort_order: 0 }),
    list({ id: 'l1', name: '이마트', sort_order: 1 }),
    list({ id: 'l2', name: '쿠팡', kind: 'online', sort_order: 2 }),
    list({ id: 'l3', name: '코스트코', sort_order: 3 }),
  ];
  const names = () => screen.getAllByTestId('list-card-name').map((n) => n.props.children);

  // 서버처럼: 저장한 순서가 다음 조회에 나온다(저장 뒤 재조회가 화면을 되돌리지 않는지 보려고).
  let server: List[] = [];
  beforeEach(() => {
    server = three();
    lists.mockImplementation(async () => server);
    (reorderLists as jest.Mock).mockImplementation(async (_familyId: string, ids: string[]) => {
      server = server.map((l) =>
        ids.includes(l.id) ? { ...l, sort_order: ids.indexOf(l.id) + 1 } : l
      );
    });
  });

  it('keeps the inbox out of the draggable data but shows it first', async () => {
    await renderWithClient(<Home />);
    await screen.findByText('이마트');
    expect((reorderableData() as List[]).map((l) => l.id)).toEqual(['l1', 'l2', 'l3']);
    expect(names()).toEqual(['사야할것', '이마트', '쿠팡', '코스트코']);
  });

  it('saves the full new order of non-inbox lists after a drop', async () => {
    await renderWithClient(<Home />);
    await screen.findByText('이마트');
    await reorderListItems(0, 1);
    expect(names()).toEqual(['사야할것', '쿠팡', '이마트', '코스트코']);
    await waitFor(() => expect(reorderLists).toHaveBeenCalledWith('g1', ['l2', 'l1', 'l3']));
  });

  it('keeps the new order while the optimistic cache update is still pending', async () => {
    await renderWithClient(<Home />);
    await screen.findByText('이마트');
    // onMutate는 cancelQueries를 기다린 뒤에 캐시를 바꾼다. 그 사이를 붙잡아 둔다.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const cancel = jest.spyOn(client, 'cancelQueries').mockImplementationOnce(() => held);
    await reorderListItems(2, 0);
    expect(cancel).toHaveBeenCalled();
    expect(
      client.getQueryData<List[]>(['lists', 'g1'])?.find((l) => l.id === 'l3')?.sort_order
    ).toBe(3);
    expect(names()).toEqual(['사야할것', '코스트코', '이마트', '쿠팡']);
    await act(async () => release());
    await waitFor(() => expect(reorderLists).toHaveBeenCalledWith('g1', ['l3', 'l1', 'l2']));
    expect(names()).toEqual(['사야할것', '코스트코', '이마트', '쿠팡']);
  });

  it('shows the old order again when saving fails', async () => {
    (reorderLists as jest.Mock).mockRejectedValue(new Error('boom'));
    await renderWithClient(<Home />);
    await screen.findByText('이마트');
    // 롤백 뒤 재조회가 끝나지 않아도(오프라인 등) 롤백한 캐시대로 옛 순서가 보여야 한다.
    lists.mockImplementation(() => new Promise(() => {}));
    await reorderListItems(0, 2);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(names()).toEqual(['사야할것', '이마트', '쿠팡', '코스트코']);
  });

  it('does nothing when a card is dropped in place', async () => {
    await renderWithClient(<Home />);
    await screen.findByText('이마트');
    await reorderListItems(1, 1);
    expect(reorderLists).not.toHaveBeenCalled();
  });

  it('ignores an unknown picked index and clamps a drop past the end to the last slot', async () => {
    await renderWithClient(<Home />);
    await screen.findByText('이마트');
    await reorderListItems(5, 0);
    expect(reorderLists).not.toHaveBeenCalled();
    expect(names()).toEqual(['사야할것', '이마트', '쿠팡', '코스트코']);
    await reorderListItems(0, 7);
    await waitFor(() => expect(reorderLists).toHaveBeenCalledWith('g1', ['l2', 'l3', 'l1']));
  });

  it('keeps the dragged order frozen while another member reorders mid-drag and moves the card picked up', async () => {
    await renderWithClient(<Home />);
    // 쿠팡(1번 자리)을 집는다.
    await fireEvent(await screen.findByText('쿠팡'), 'longPress');
    // 끄는 사이 다른 가족이 순서를 바꿔(코스트코, 이마트, 쿠팡) 재조회가 도착한다. 목록 수는 같다.
    server = server.map((l) => ({ ...l, sort_order: { l3: 1, l1: 2, l2: 3 }[l.id] ?? 0 }));
    await act(async () => {
      await client.refetchQueries({ queryKey: ['lists', 'g1'] });
    });
    await waitFor(() =>
      expect(client.getQueryData<List[]>(['lists', 'g1'])?.find((l) => l.id === 'l3')?.sort_order).toBe(1)
    );
    // 끄는 동안에는 집을 때의 순서 그대로 그려 라이브러리의 자리 계산이 흔들리지 않는다.
    expect(names()).toEqual(['사야할것', '이마트', '쿠팡', '코스트코']);
    // 집은 쿠팡을 맨 아래(2번 자리)에 놓는다. 다른 목록(이마트)이 옮겨지면 안 된다.
    await reorderListItems(1, 2);
    await waitFor(() => expect(reorderLists).toHaveBeenCalledWith('g1', ['l1', 'l3', 'l2']));
    expect(names()).toEqual(['사야할것', '이마트', '코스트코', '쿠팡']);
  });

  it('unfreezes when the card is released in place', async () => {
    await renderWithClient(<Home />);
    await fireEvent(await screen.findByText('쿠팡'), 'longPress');
    server = server.map((l) => ({ ...l, sort_order: { l3: 1, l1: 2, l2: 3 }[l.id] ?? 0 }));
    await act(async () => {
      await client.refetchQueries({ queryKey: ['lists', 'g1'] });
    });
    expect(names()).toEqual(['사야할것', '이마트', '쿠팡', '코스트코']);
    await reorderListItems(1, 1);
    await waitFor(() => expect(names()).toEqual(['사야할것', '코스트코', '이마트', '쿠팡']));
    expect(reorderLists).not.toHaveBeenCalled();
  });

  it('lets screen-reader users move a card one step with accessibility actions', async () => {
    await renderWithClient(<Home />);
    const card = (name: string) =>
      screen.getAllByRole('button').find((b) => within(b).queryByText(name))!;
    await screen.findByText('이마트');
    const actionNames = (name: string) =>
      (card(name).props.accessibilityActions ?? []).map((a: { name: string }) => a.name);
    expect(actionNames('사야할것')).toEqual([]);
    expect(actionNames('이마트')).toEqual(['moveDown']);
    expect(actionNames('쿠팡')).toEqual(['moveUp', 'moveDown']);
    expect(actionNames('코스트코')).toEqual(['moveUp']);
    await fireEvent(card('코스트코'), 'accessibilityAction', {
      nativeEvent: { actionName: 'moveUp' },
    });
    expect(names()).toEqual(['사야할것', '이마트', '코스트코', '쿠팡']);
    await waitFor(() => expect(reorderLists).toHaveBeenCalledWith('g1', ['l1', 'l3', 'l2']));
  });

  it('picks a card up on long press but not the inbox', async () => {
    await renderWithClient(<Home />);
    await fireEvent(await screen.findByText('쿠팡'), 'longPress');
    await fireEvent(screen.getByText('사야할것'), 'longPress');
    expect(draggedIndexes()).toEqual([1]);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('still navigates on a short press of a draggable card', async () => {
    await renderWithClient(<Home />);
    await fireEvent.press(await screen.findByText('쿠팡'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/list/[id]', params: { id: 'l2' } });
    expect(draggedIndexes()).toEqual([]);
  });
});

it('does not crash and shows no lists when there are no groups', async () => {
  families.mockResolvedValue([]);
  await renderWithClient(<Home />);
  await waitFor(() => expect(families).toHaveBeenCalled());
  expect(lists).not.toHaveBeenCalled();
  expect(screen.queryByText('+ 목록 추가')).toBeNull();
});

describe('no group (e.g. creating the personal group failed after leaving the last one)', () => {
  it('offers a retry that refetches onboarding and groups, and recovers', async () => {
    families.mockResolvedValue([]);
    await renderWithClient(<Home />);
    expect(await screen.findByText('그룹을 불러오지 못했어요')).toBeTruthy();
    const spy = jest.spyOn(client, 'invalidateQueries');
    families.mockResolvedValue([G1]);
    await fireEvent.press(screen.getByText('다시 시도'));
    const calls = spy.mock.calls.map((c) => c[0] as { queryKey: unknown[]; refetchType?: string });
    expect(calls).toEqual(
      expect.arrayContaining([
        { queryKey: ['onboarding', 'u1'], refetchType: 'all' },
        { queryKey: ['families'], refetchType: 'all' },
      ])
    );
    expect(await screen.findByText('우리집')).toBeTruthy();
  });

  it('uses the stored user id in offline-user mode for the retry (F6)', async () => {
    mockAuth = { session: null, loading: false, offlineUserId: 'u9' };
    try {
      families.mockResolvedValue([]);
      await renderWithClient(<Home />);
      expect(await screen.findByText('그룹을 불러오지 못했어요')).toBeTruthy();
      const spy = jest.spyOn(client, 'invalidateQueries');
      await fireEvent.press(screen.getByText('다시 시도'));
      expect(spy.mock.calls.map((c) => c[0])).toContainEqual({
        queryKey: ['onboarding', 'u9'],
        refetchType: 'all',
      });
    } finally {
      mockAuth = { session: { user: { id: 'u1' } }, loading: false, offlineUserId: null };
    }
  });

  it('keeps settings reachable', async () => {
    families.mockResolvedValue([]);
    await renderWithClient(<Home />);
    await fireEvent.press(await screen.findByRole('button', { name: '설정' }));
    expect(mockPush).toHaveBeenCalledWith('/settings');
  });
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
    await waitFor(async () =>
      expect(await AsyncStorage.getItem('cart-note-current-group')).toBe('g2')
    );
  });

  it('navigates to the join screen', async () => {
    families.mockResolvedValue([G1, G2]);
    await renderWithClient(<Home />);
    await fireEvent.press(await screen.findByText('우리집 ▾'));
    await fireEvent.press(await screen.findByText('코드로 참여'));
    expect(mockPush).toHaveBeenCalledWith('/join');
  });

  it('renames through a sheet and blocks a whitespace-only name', async () => {
    families.mockResolvedValue([G1, G2]);
    (renameFamily as jest.Mock).mockResolvedValue(undefined);
    await renderWithClient(<Home />);
    await fireEvent.press(await screen.findByText('우리집 ▾'));
    await fireEvent.press(await screen.findByText('이름 변경'));
    const input = await screen.findByPlaceholderText('그룹 이름');
    expect(input.props.maxLength).toBe(50);
    await fireEvent.changeText(input, '   ');
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
    expect(renameFamily).not.toHaveBeenCalled();
    await fireEvent.changeText(input, ' 새 이름 ');
    await fireEvent.press(screen.getByText('저장'));
    await waitFor(() => expect(renameFamily).toHaveBeenCalledWith('g1', '새 이름'));
    await waitFor(() => expect(families).toHaveBeenCalledTimes(2)); // families 무효화 → 재조회
  });

  it('a failed rename hides the keyboard before the error toast and keeps the sheet open', async () => {
    // 토스트는 화면 아래에 떠서, 입력 칸이 열린 채면 iOS 키보드에 가린다.
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    families.mockResolvedValue([G1, G2]);
    (renameFamily as jest.Mock).mockRejectedValueOnce(new Error('network'));
    await renderWithClient(<Home />);
    await fireEvent.press(await screen.findByText('우리집 ▾'));
    await fireEvent.press(await screen.findByText('이름 변경'));
    const input = await screen.findByPlaceholderText('그룹 이름');
    await fireEvent.changeText(input, '새 이름');
    await fireEvent.press(screen.getByText('저장'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('이름을 바꾸지 못했어요'));
    expect(dismiss).toHaveBeenCalled();
    expect(dismiss.mock.invocationCallOrder[0]).toBeLessThan(
      (toast.error as jest.Mock).mock.invocationCallOrder[0]
    );
    expect(screen.getByPlaceholderText('그룹 이름')).toBeTruthy();
    dismiss.mockRestore();
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
    expect(input.props.maxLength).toBe(50);
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

  it('exposes the kind toggle as radio buttons with the selected state', async () => {
    await renderWithClient(<Home />);
    await fireEvent.press(await screen.findByText('+ 목록 추가'));
    expect(await screen.findByRole('radio', { name: '마트', selected: true })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '온라인', selected: false })).toBeTruthy();
    expect(screen.queryByText('사이트')).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: '온라인' }));
    expect(screen.getByRole('radio', { name: '온라인', selected: true })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '마트', selected: false })).toBeTruthy();
  });

  it('can create an online list', async () => {
    await renderWithClient(<Home />);
    await fireEvent.press(await screen.findByText('+ 목록 추가'));
    await fireEvent.press(await screen.findByText('온라인'));
    await fireEvent.changeText(await screen.findByPlaceholderText('목록 이름'), '쿠팡');
    await fireEvent.press(screen.getByText('저장'));
    await waitFor(() =>
      expect(insertList).toHaveBeenCalledWith(
        expect.objectContaining({ name: '쿠팡', kind: 'online' })
      )
    );
  });
});

describe('load error', () => {
  it('shows an offline state instead of a spinner when paused with no data', async () => {
    client.setQueryData(['families'], [G1]);
    onlineManager.setOnline(false);
    await renderWithClient(<Home />);
    expect(await screen.findByText('오프라인이라 불러올 수 없어요')).toBeTruthy();
  });

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

it('opens settings from the header gear button', async () => {
  await renderWithClient(<Home />);
  await fireEvent.press(await screen.findByLabelText('설정'));
  expect(mockPush).toHaveBeenCalledWith('/settings');
});

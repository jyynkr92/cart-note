import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Locations from '@/app/(app)/list/[id]/locations';
import { fetchMyFamilies, fetchFamilyMembers, type Family } from '@/src/groups/group-api';
import { resetCurrentGroupStore } from '@/src/groups/current-group-store';
import { fetchLists, type List } from '@/src/lists/list-api';
import {
  deleteLocation,
  fetchLocations,
  insertLocation,
  searchPlaces,
  type ListLocation,
} from '@/src/locations/location-api';
import { createQueryClient } from '@/src/lib/query-client';
import { qk } from '@/src/lib/query-keys';
import { disposeClient } from '@/test-utils/dispose-client';

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
jest.mock('@/src/locations/location-api', () => ({
  searchPlaces: jest.fn(),
  fetchLocations: jest.fn(),
  insertLocation: jest.fn(),
  deleteLocation: jest.fn(),
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
const loc = (o: Partial<ListLocation> & Pick<ListLocation, 'id' | 'place_name'>): ListLocation => ({
  list_id: 'l1',
  family_id: 'g1',
  address: '서울',
  lat: 1,
  lng: 2,
  kakao_place_id: 'k-' + o.id,
  radius_m: 300,
  ...o,
});
const place = (id: string, name: string) => ({
  kakao_place_id: id,
  place_name: name,
  address: '서울 서초구',
  lat: 37.4,
  lng: 127.0,
});

const search = searchPlaces as jest.Mock;
const locations = fetchLocations as jest.Mock;

let client: QueryClient;
const renderScreen = () =>
  render(
    <QueryClientProvider client={client}>
      <Locations />
    </QueryClientProvider>
  );

async function doSearch(q = '코스트코') {
  await fireEvent.changeText(await screen.findByPlaceholderText(/지점 검색/), q);
  await fireEvent.press(screen.getByRole('button', { name: '검색' }));
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
  (fetchLists as jest.Mock).mockResolvedValue([list({ id: 'l1', name: '코스트코' })]);
  locations.mockResolvedValue([]);
  (insertLocation as jest.Mock).mockResolvedValue(undefined);
  (deleteLocation as jest.Mock).mockResolvedValue(undefined);
});
afterEach(async () => {
  await cleanup();
  disposeClient(client);
});

it('shows search results and adds one on tap with the default radius', async () => {
  search.mockResolvedValue([place('k1', '코스트코 양재점'), place('k2', '코스트코 상봉점')]);
  (insertLocation as jest.Mock).mockImplementation(async () => {
    locations.mockResolvedValue([loc({ id: 'new', place_name: '코스트코 양재점' })]); // 서버 반영
  });
  await renderScreen();
  await doSearch();
  expect(search).toHaveBeenCalledWith('코스트코');
  await fireEvent.press(await screen.findByRole('button', { name: '코스트코 양재점 추가' }));
  await waitFor(() =>
    expect(insertLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        listId: 'l1',
        familyId: 'g1',
        radiusM: 300,
        place: expect.objectContaining({ kakao_place_id: 'k1' }),
      })
    )
  );
  expect(await screen.findByTestId('location-name')).toHaveTextContent('코스트코 양재점');
});

it('invalidates locations, allLocations and lists after adding', async () => {
  search.mockResolvedValue([place('k1', '코스트코 양재점')]);
  await renderScreen();
  const spy = jest.spyOn(client, 'invalidateQueries');
  await doSearch();
  await fireEvent.press(await screen.findByRole('button', { name: '코스트코 양재점 추가' }));
  await waitFor(() => {
    const keys = spy.mock.calls.map((c) => JSON.stringify((c[0] as any)?.queryKey));
    expect(keys).toEqual(
      expect.arrayContaining([
        JSON.stringify(['locations']),
        JSON.stringify(qk.allLocations()),
        JSON.stringify(['lists']),
      ])
    );
  });
});

it('does not add a place already registered on this list', async () => {
  locations.mockResolvedValue([loc({ id: 'a', place_name: '코스트코 양재점', kakao_place_id: 'k1' })]);
  search.mockResolvedValue([place('k1', '코스트코 양재점')]);
  await renderScreen();
  await screen.findByTestId('location-name');
  await doSearch();
  const row = await screen.findByRole('button', { name: '코스트코 양재점 추가' });
  expect(row).toBeDisabled();
  await fireEvent.press(row);
  expect(insertLocation).not.toHaveBeenCalled();
});

it('shows a retry message when search fails, and retries', async () => {
  search.mockRejectedValueOnce(new Error('502')).mockResolvedValueOnce([place('k1', '코스트코')]);
  await renderScreen();
  await doSearch();
  expect(await screen.findByText('검색에 실패했어요. 다시 시도해 주세요')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
  expect(await screen.findByRole('button', { name: '코스트코 추가' })).toBeTruthy();
  expect(search).toHaveBeenCalledTimes(2);
});

it('does not search on a blank query', async () => {
  await renderScreen();
  await doSearch('   ');
  expect(search).not.toHaveBeenCalled();
});

it('deletes a registered location with the 삭제 button', async () => {
  locations.mockResolvedValue([loc({ id: 'a', place_name: '코스트코 양재점' })]);
  await renderScreen();
  await screen.findByText('코스트코 양재점');
  locations.mockResolvedValue([]); // 삭제 후 재조회 결과
  await fireEvent.press(screen.getByRole('button', { name: '삭제' }));
  await waitFor(() => expect(deleteLocation).toHaveBeenCalledWith('a'));
  await waitFor(() => expect(screen.queryByText('코스트코 양재점')).toBeNull());
});

it('shows not-found for a non-store list', async () => {
  (fetchLists as jest.Mock).mockResolvedValue([list({ id: 'l1', name: '쿠팡', kind: 'online' })]);
  await renderScreen();
  expect(await screen.findByText('목록을 찾을 수 없어요')).toBeTruthy();
});

it('shows not-found for an unknown list', async () => {
  mockParams = { id: 'nope' };
  await renderScreen();
  expect(await screen.findByText('목록을 찾을 수 없어요')).toBeTruthy();
});

it('keeps an optimistic row while an earlier add is still in flight (no mid-queue flash)', async () => {
  search.mockResolvedValue([place('k1', '코스트코 양재점'), place('k2', '코스트코 상봉점')]);
  locations.mockResolvedValue([]);
  let release!: () => void;
  let release2!: () => void;
  (insertLocation as jest.Mock)
    .mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
    .mockImplementationOnce(() => new Promise<void>((r) => (release2 = r)));
  await renderScreen();
  await doSearch();
  await waitFor(() => expect(fetchLocations).toHaveBeenCalled());
  await fireEvent.press(await screen.findByRole('button', { name: '코스트코 양재점 추가' }));
  await fireEvent.press(await screen.findByRole('button', { name: '코스트코 상봉점 추가' }));
  await waitFor(() => expect(screen.getAllByTestId('location-name')).toHaveLength(2));
  const before = locations.mock.calls.length;
  release(); // 첫 mutation 성공 — 둘째가 아직 큐에 있으므로 재조회하면 안 된다.
  await waitFor(() => expect(insertLocation).toHaveBeenCalledTimes(2));
  expect(screen.getAllByTestId('location-name')).toHaveLength(2);
  expect(locations.mock.calls.length).toBe(before);
  release2();
});

it('retry re-runs the failed query, not the current input', async () => {
  search.mockRejectedValueOnce(new Error('502')).mockResolvedValueOnce([place('k1', '코스트코')]);
  await renderScreen();
  await doSearch('코스트코');
  await screen.findByText('검색에 실패했어요. 다시 시도해 주세요');
  await fireEvent.changeText(screen.getByPlaceholderText(/지점 검색/), '이마트');
  await fireEvent.press(screen.getByRole('button', { name: '다시 시도' }));
  await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
  expect(search).toHaveBeenLastCalledWith('코스트코');
});

it('offline search fails to the retry message instead of hanging', async () => {
  search.mockRejectedValue(new Error('offline'));
  await renderScreen();
  await screen.findByPlaceholderText(/지점 검색/);
  await act(async () => onlineManager.setOnline(false)); // 화면이 뜬 뒤 오프라인이 된다
  await doSearch();
  expect(await screen.findByText('검색에 실패했어요. 다시 시도해 주세요')).toBeTruthy();
});

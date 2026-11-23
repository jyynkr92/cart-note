import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { disposeClient } from '@/test-utils/dispose-client';
import * as api from '@/src/lists/list-api';
import type { List } from '@/src/lists/list-api';
import { useCreateList, useRenameList } from '@/src/lists/use-lists';
import { createQueryClient } from '@/src/lib/query-client';
import { qk } from '@/src/lib/query-keys';

jest.mock('@/src/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/src/lib/toast', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/src/items/item-api', () => ({}));
jest.mock('@/src/lists/list-api', () => ({
  fetchLists: jest.fn(),
  insertList: jest.fn(),
  renameList: jest.fn(),
  deleteList: jest.fn(),
}));
const mocked = api as jest.Mocked<typeof api>;

const list: List = {
  id: 'l1',
  family_id: 'f1',
  name: '마트',
  kind: 'store',
  sort_order: 0,
  created_at: '2026-01-01T00:00:00.000Z',
};

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  onlineManager.setOnline(true);
  client = createQueryClient();
  client.setQueryData(qk.lists('f1'), [list]);
});
afterEach(() => disposeClient(client));

it('ignores a whitespace-only name when creating a list', async () => {
  const { result } = await renderHook(() => useCreateList(), { wrapper });
  await act(async () => {
    result.current.mutate({ familyId: 'f1', name: '   ' });
    await result.current.mutateAsync({ familyId: 'f1', name: ' ' });
  });
  expect(mocked.insertList).not.toHaveBeenCalled();
  expect(client.getQueryData<List[]>(qk.lists('f1'))).toEqual([list]);
  expect(client.getMutationCache().getAll()).toHaveLength(0);
});

it('ignores a whitespace-only name when renaming a list', async () => {
  const { result } = await renderHook(() => useRenameList(), { wrapper });
  await act(async () => {
    result.current.mutate({ id: 'l1', familyId: 'f1', name: '  ' });
    await result.current.mutateAsync({ id: 'l1', familyId: 'f1', name: '' });
  });
  expect(mocked.renameList).not.toHaveBeenCalled();
  expect(client.getQueryData<List[]>(qk.lists('f1'))![0].name).toBe('마트');
});

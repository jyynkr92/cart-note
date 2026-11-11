import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { Family } from '@/src/groups/group-api';
import {
  CURRENT_GROUP_KEY,
  resetCurrentGroupStore,
  resolveCurrentFamily,
  useCurrentGroupStore,
} from '@/src/groups/current-group-store';

const fam = (id: string, created_at: string): Family => ({
  id,
  name: id,
  invite_code: '000000',
  created_at,
  created_by: 'u1',
});
const A = fam('a', '2026-01-01T00:00:00Z');
const B = fam('b', '2026-02-01T00:00:00Z');

describe('resolveCurrentFamily', () => {
  it('keeps the saved id when it is in the list', () => {
    expect(resolveCurrentFamily('b', [A, B])).toBe('b');
  });
  it('falls back to the oldest group when the saved id is gone', () => {
    expect(resolveCurrentFamily('gone', [B, A])).toBe('a');
    expect(resolveCurrentFamily(null, [A, B])).toBe('a');
  });
  it('returns null when there are no groups', () => {
    expect(resolveCurrentFamily(null, [])).toBeNull();
    expect(resolveCurrentFamily('a', [])).toBeNull();
  });
});

describe('useCurrentGroupStore', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    resetCurrentGroupStore();
  });

  it('hydrates a saved id from AsyncStorage', async () => {
    await AsyncStorage.setItem(CURRENT_GROUP_KEY, 'b');
    const { result } = await renderHook(() => useCurrentGroupStore());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.familyId).toBe('b');
  });

  it('starts with null and does not crash when nothing is saved', async () => {
    const { result } = await renderHook(() => useCurrentGroupStore());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.familyId).toBeNull();
  });

  it('persists the selected id', async () => {
    const { result } = await renderHook(() => useCurrentGroupStore());
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => result.current.setFamilyId('a'));
    expect(result.current.familyId).toBe('a');
    expect(await AsyncStorage.getItem(CURRENT_GROUP_KEY)).toBe('a');
  });
});

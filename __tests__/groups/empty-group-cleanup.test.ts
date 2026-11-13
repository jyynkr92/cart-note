import { findEmptySoloGroups, loadEmptySoloGroups } from '@/src/groups/empty-group-cleanup';
import { familyIsEmpty, fetchMyFamilies } from '@/src/groups/group-api';

jest.mock('@/src/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/src/groups/group-api', () => ({
  fetchMyFamilies: jest.fn(),
  familyIsEmpty: jest.fn(),
}));

const g = (id: string, isEmpty: boolean) => ({ id, name: `n-${id}`, isEmpty });

describe('findEmptySoloGroups', () => {
  it('returns groups the server reports as empty', () => {
    expect(findEmptySoloGroups([g('a', true)], 'j')).toEqual([{ id: 'a', name: 'n-a' }]);
  });
  it('excludes non-empty groups', () => {
    expect(findEmptySoloGroups([g('a', false)], 'j')).toEqual([]);
  });
  it('excludes the group just joined', () => {
    expect(findEmptySoloGroups([g('j', true)], 'j')).toEqual([]);
  });
});

describe('loadEmptySoloGroups', () => {
  beforeEach(() => jest.clearAllMocks());

  it('asks the server whether each group is empty (members, items, lists and locations), skipping the joined group (R4)', async () => {
    (fetchMyFamilies as jest.Mock).mockResolvedValue([
      { id: 'solo', name: '내 장보기' },
      { id: 'j', name: '가족' },
      { id: 'lists', name: '목록만 있는 그룹' },
    ]);
    (familyIsEmpty as jest.Mock).mockImplementation(async (id: string) => id === 'solo');
    expect(await loadEmptySoloGroups('j')).toEqual([{ id: 'solo', name: '내 장보기' }]);
    expect(familyIsEmpty).not.toHaveBeenCalledWith('j');
    expect(familyIsEmpty).toHaveBeenCalledWith('lists');
  });

  it('returns [] when loading fails', async () => {
    (fetchMyFamilies as jest.Mock).mockRejectedValue(new Error('boom'));
    expect(await loadEmptySoloGroups('j')).toEqual([]);
  });

  it('returns [] when a single check fails', async () => {
    (fetchMyFamilies as jest.Mock).mockResolvedValue([{ id: 'solo', name: '내 장보기' }]);
    (familyIsEmpty as jest.Mock).mockRejectedValue(new Error('boom'));
    expect(await loadEmptySoloGroups('j')).toEqual([]);
  });
});

import { findEmptySoloGroups, loadEmptySoloGroups } from '@/src/groups/empty-group-cleanup';
import { familyItemCount, fetchFamilyMembers, fetchMyFamilies } from '@/src/groups/group-api';

jest.mock('@/src/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/src/groups/group-api', () => ({
  fetchMyFamilies: jest.fn(),
  fetchFamilyMembers: jest.fn(),
  familyItemCount: jest.fn(),
}));

const g = (id: string, memberCount: number, itemCount: number) => ({
  id,
  name: `n-${id}`,
  memberCount,
  itemCount,
});

describe('findEmptySoloGroups', () => {
  it('returns groups with one member and no items', () => {
    expect(findEmptySoloGroups([g('a', 1, 0)], 'j')).toEqual([{ id: 'a', name: 'n-a' }]);
  });
  it('excludes groups with 2+ members', () => {
    expect(findEmptySoloGroups([g('a', 2, 0)], 'j')).toEqual([]);
  });
  it('excludes groups that have items', () => {
    expect(findEmptySoloGroups([g('a', 1, 1)], 'j')).toEqual([]);
  });
  it('excludes the group just joined', () => {
    expect(findEmptySoloGroups([g('j', 1, 0)], 'j')).toEqual([]);
  });
});

describe('loadEmptySoloGroups', () => {
  beforeEach(() => jest.clearAllMocks());

  it('builds the input from the api, skipping the joined group', async () => {
    (fetchMyFamilies as jest.Mock).mockResolvedValue([
      { id: 'solo', name: '내 장보기' },
      { id: 'j', name: '가족' },
      { id: 'busy', name: '회사' },
    ]);
    (fetchFamilyMembers as jest.Mock).mockImplementation(async (id: string) =>
      id === 'solo' ? [{ user_id: 'u1' }] : [{ user_id: 'u1' }, { user_id: 'u2' }]
    );
    (familyItemCount as jest.Mock).mockResolvedValue(0);
    expect(await loadEmptySoloGroups('j')).toEqual([{ id: 'solo', name: '내 장보기' }]);
    expect(fetchFamilyMembers).not.toHaveBeenCalledWith('j');
  });

  it('returns [] when loading fails', async () => {
    (fetchMyFamilies as jest.Mock).mockRejectedValue(new Error('boom'));
    expect(await loadEmptySoloGroups('j')).toEqual([]);
  });
});

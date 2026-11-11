import { canNotify } from '@/src/geofence/cooldown';
import { notificationText } from '@/src/geofence/notification-text';
import { selectRegions } from '@/src/geofence/select-regions';

describe('selectRegions', () => {
  // 0번이 가장 멀고 24번이 가장 가깝다(위도 차이가 커질수록 멀다).
  const locs = Array.from({ length: 25 }, (_, i) => ({ id: `l${i}`, lat: 37.5 + (24 - i) * 0.01, lng: 127 }));

  it('picks the 20 nearest when a position is known, nearest first', () => {
    const picked = selectRegions(locs, { lat: 37.5, lng: 127 });
    expect(picked).toHaveLength(20);
    expect(picked.map((l) => l.id)).toEqual(
      Array.from({ length: 20 }, (_, k) => `l${24 - k}`)
    );
  });

  it('takes the first 20 without a position', () => {
    const picked = selectRegions(locs, null);
    expect(picked.map((l) => l.id)).toEqual(locs.slice(0, 20).map((l) => l.id));
  });

  it('respects a custom max and short inputs', () => {
    expect(selectRegions(locs, null, 3)).toHaveLength(3);
    expect(selectRegions(locs.slice(0, 2), { lat: 0, lng: 0 })).toHaveLength(2);
  });
});

describe('canNotify', () => {
  const H = 60 * 60 * 1000;
  const now = 1_800_000_000_000;

  it('blocks within 3 hours', () => {
    expect(canNotify('a', now, { a: now - (3 * H - 60_000) })).toBe(false);
  });
  it('allows at exactly 3 hours', () => {
    expect(canNotify('a', now, { a: now - 3 * H })).toBe(true);
  });
  it('allows with no record', () => {
    expect(canNotify('a', now, { b: now })).toBe(true);
  });
});

describe('notificationText', () => {
  it('prefixes the group name when there are several groups', () => {
    expect(
      notificationText({ groupName: '부모님댁', placeName: '코스트코 양재점', count: 6, groupCount: 2 })
    ).toBe('[부모님댁] 코스트코 양재점 근처예요 · 사야 할 것 6개');
  });
  it('omits the group name with a single group', () => {
    expect(
      notificationText({ groupName: '부모님댁', placeName: '코스트코 양재점', count: 6, groupCount: 1 })
    ).toBe('코스트코 양재점 근처예요 · 사야 할 것 6개');
  });
  it('omits the count when unknown', () => {
    expect(
      notificationText({ groupName: '부모님댁', placeName: '코스트코 양재점', count: null, groupCount: 1 })
    ).toBe('코스트코 양재점 근처예요');
  });
});

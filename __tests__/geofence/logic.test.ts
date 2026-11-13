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

  it('drops rows with out-of-range or non-finite coordinates or radius (A4)', () => {
    const ok = { id: 'ok', lat: 37.5, lng: 127, radius_m: 300 };
    const bad = [
      { id: 'lat', lat: 91, lng: 127, radius_m: 300 },
      { id: 'lng', lat: 37.5, lng: -181, radius_m: 300 },
      { id: 'nan', lat: NaN, lng: 127, radius_m: 300 },
      { id: 'inf', lat: 37.5, lng: Infinity, radius_m: 300 },
      { id: 'small', lat: 37.5, lng: 127, radius_m: 10 },
      { id: 'big', lat: 37.5, lng: 127, radius_m: 100_000 },
    ];
    expect(selectRegions([...bad, ok], null).map((l) => l.id)).toEqual(['ok']);
    expect(selectRegions([...bad, ok], { lat: 37.5, lng: 127 }).map((l) => l.id)).toEqual(['ok']);
    // 반경이 없으면 기본값(300m)을 쓰므로 유효하다.
    expect(selectRegions([{ id: 'nul', lat: 1, lng: 1, radius_m: null }], null)).toHaveLength(1);
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
  it('keeps the group prefix with several groups even when the count is unknown', () => {
    expect(
      notificationText({ groupName: '부모님댁', placeName: '코스트코 양재점', count: null, groupCount: 2 })
    ).toBe('[부모님댁] 코스트코 양재점 근처예요');
  });
  it('omits the count when unknown', () => {
    expect(
      notificationText({ groupName: '부모님댁', placeName: '코스트코 양재점', count: null, groupCount: 1 })
    ).toBe('코스트코 양재점 근처예요');
  });
});

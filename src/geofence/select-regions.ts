export type Point = { lat: number; lng: number };

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** 두 좌표 사이 거리(m). */
export function haversine(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** iOS 지오펜스 한도(20곳). 현재 위치를 모르면 앞에서부터, 알면 가까운 순으로 max개를 고른다. */
export function selectRegions<Loc extends Point>(locs: Loc[], here: Point | null, max = 20): Loc[] {
  if (!here) return locs.slice(0, max);
  return locs
    .map((loc) => ({ loc, d: haversine(here, loc) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, max)
    .map((x) => x.loc);
}

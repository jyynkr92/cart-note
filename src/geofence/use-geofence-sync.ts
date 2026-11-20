import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { qk } from '@/src/lib/query-keys';
import type { List } from '@/src/lists/list-api';
import { fetchAllMyLocations } from '@/src/locations/location-api';
import { mergeOpenCounts } from './geofence-store';
import { syncGeofences } from './sync-geofences';

const DEBOUNCE_MS = 500;

/**
 * (app) 레이아웃이 ready일 때: 시작/포그라운드 복귀/모든 그룹 지점(qk.allLocations) 변경 시
 * 지오펜스를 다시 맞추고, 목록 쿼리의 미완료 개수를 백그라운드 작업용 스냅샷에 적어 둔다.
 */
export function useGeofenceSync(active: boolean): void {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: qk.allLocations(),
    queryFn: fetchAllMyLocations,
    enabled: active,
  });

  useEffect(() => {
    if (!active) return;
    void syncGeofences();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void syncGeofences();
    });
    return () => sub.remove();
  }, [active]);

  useEffect(() => {
    if (!active || !data) return;
    const t = setTimeout(() => void syncGeofences({ locations: data }), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [active, data]);

  useEffect(() => {
    if (!active) return;
    return qc.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success') return;
      if (event.query.queryKey[0] !== 'lists') return;
      const lists = event.query.state.data as List[] | undefined;
      const counts: Record<string, number> = {};
      for (const l of lists ?? []) {
        if (typeof l.unfinished_count === 'number') counts[l.id] = l.unfinished_count;
      }
      if (Object.keys(counts).length > 0) void mergeOpenCounts(counts);
    });
  }, [active, qc]);
}

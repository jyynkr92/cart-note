import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/src/lib/supabase';
import { applyChange, type RealtimeTable } from './apply-change';

const TABLES: RealtimeTable[] = ['items', 'lists', 'list_locations'];

/**
 * 현재 그룹의 변경을 Realtime으로 받아 쿼리 캐시에 반영한다.
 * INSERT/UPDATE는 family_id로 필터링하고, DELETE는 필터를 걸 수 없어 전체를 받아 무효화만 한다.
 */
export function useFamilyRealtime(familyId: string | null): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!familyId) return;
    let channel = supabase.channel(`family:${familyId}`);
    for (const table of TABLES) {
      for (const event of ['INSERT', 'UPDATE'] as const) {
        channel = channel.on(
          'postgres_changes',
          { event, schema: 'public', table, filter: `family_id=eq.${familyId}` },
          (payload) => applyChange(qc, table, payload)
        );
      }
      channel = channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table }, (payload) =>
        applyChange(qc, table, payload)
      );
    }
    let subscribedBefore = false;
    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      // 끊겼다가 돌아오면 그 사이 놓친 이벤트를 서버 상태로 메운다.
      if (subscribedBefore) void qc.invalidateQueries();
      subscribedBefore = true;
    });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyId, qc]);
}

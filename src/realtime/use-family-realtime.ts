import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { mk } from '@/src/lib/query-keys';
import { newId } from '@/src/lib/mutation-utils';
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
    // 같은 토픽을 재사용하면 아직 leave 중인 채널이 반환돼 subscribe()가 무시된다 → effect마다 고유 토픽.
    // wait: replication slot이 준비되기 전의 구독 직후 이벤트 유실을 줄인다.
    let channel = supabase.channel(`family:${familyId}:${newId()}`, {
      config: { postgres_changes_options: { wait: true } },
    });
    for (const table of TABLES) {
      for (const event of ['INSERT', 'UPDATE'] as const) {
        channel = channel.on(
          'postgres_changes',
          { event, schema: 'public', table, filter: `family_id=eq.${familyId}` },
          (payload) => applyChange(qc, table, payload)
        );
      }
      channel = channel.on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table },
        (payload) => applyChange(qc, table, payload)
      );
    }
    let disposed = false;
    channel.subscribe((status) => {
      if (disposed || status !== 'SUBSCRIBED') return;
      // 첫 구독 직후와 재연결 때 놓친 이벤트를 서버 상태로 메운다.
      // 대기 중인 mutation이 있으면 낙관적 items/lists는 건드리지 않는다(큐가 비면 invalidateWhenIdle이 처리).
      if (qc.isMutating({ mutationKey: mk.all }) > 0) {
        void qc.invalidateQueries({
          predicate: (q) => q.queryKey[0] !== 'items' && q.queryKey[0] !== 'lists',
        });
      } else {
        void qc.invalidateQueries();
      }
    });
    return () => {
      disposed = true;
      void supabase.removeChannel(channel);
    };
  }, [familyId, qc]);
}

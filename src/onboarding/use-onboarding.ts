import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createFamily, fetchMyFamilies } from '@/src/groups/group-api';
import { useFamilies } from '@/src/groups/use-groups';
import { isNetworkError } from '@/src/lib/network-error';
import { qk } from '@/src/lib/query-keys';
import { clearOnboarded, isOnboarded, markOnboarded } from './onboarded-flag';
import { getPendingInvite } from './pending-invite';
import { hasProfile } from './profile-api';
import { resolveOnboarding, type OnboardingStep } from './resolve-onboarding';

export const PERSONAL_GROUP_NAME = '내 장보기';

type State = {
  step: OnboardingStep | null; // null = 로딩 중
  pendingInvite: string | null;
  error: boolean;
  /** 첫 확인이 오프라인이라 멈춰 있음(캐시된 상태도 없음). */
  offline: boolean;
  retry: () => void;
};

type Resolved = { step: OnboardingStep; pendingInvite: string | null };

// 진행 중인 개인 그룹 생성. 사용자별로 구분해서 로그아웃/로그인 사이에 새지 않게 한다.
const creating = new Map<string, Promise<string>>();

function createPersonalOnce(userId: string): Promise<string> {
  let p = creating.get(userId);
  if (!p) {
    p = createFamily(PERSONAL_GROUP_NAME).finally(() => creating.delete(userId));
    creating.set(userId, p);
  }
  return p;
}

async function resolveForUser(userId: string, qc: QueryClient): Promise<Resolved> {
  const [profile, pending, families] = await Promise.all([
    hasProfile(userId),
    getPendingInvite(),
    fetchMyFamilies(),
  ]);
  const next = resolveOnboarding({
    hasSession: true,
    hasProfile: profile,
    pendingInvite: pending,
    groupCount: families.length,
  });
  if (next === 'create-personal') {
    await createPersonalOnce(userId);
    // 홈이 먼저 받아 둔 빈 그룹 목록을 새 그룹으로 바꾼 뒤에 ready로 넘어간다(빈 홈 방지).
    await qc.invalidateQueries({ queryKey: qk.families(), refetchType: 'all' });
    await markOnboarded(userId);
    return { step: 'ready', pendingInvite: pending };
  }
  // 오프라인 콜드 스타트에서 캐시로 홈을 보여 줄 수 있게 표시한다(프로필이 없으면 지운다).
  if (next === 'ready') await markOnboarded(userId);
  else if (next === 'profile') await clearOnboarded();
  return { step: next, pendingInvite: pending };
}

/**
 * 가드용 상태 조회. 사용자별 query key라서 계정이 바뀌면 상태가 섞이지 않고,
 * 프로필 저장/그룹 참여 후 `qk.onboarding(userId)`를 무효화하면 리마운트 없이 다음 단계로 넘어간다.
 */
export function useOnboarding(userId: string | null): State {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: qk.onboarding(userId ?? ''),
    queryFn: () => resolveForUser(userId!, qc),
    enabled: !!userId,
    retry: false,
    staleTime: 0,
  });
  const { refetch } = q;
  const retry = useCallback(() => void refetch(), [refetch]);
  const families = useFamilies().data;

  // 이 사용자가 온보딩을 마친 적이 있는지(기기 로컬). 첫 확인이 서버에 닿지 못할 때만 쓴다.
  const [flag, setFlag] = useState<{ userId: string; ok: boolean } | null>(null);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void isOnboarded(userId).then((ok) => alive && setFlag({ userId, ok }));
    return () => {
      alive = false;
    };
  }, [userId]);
  // 캐시로 홈을 보여 준 사용자. 연결이 돌아와 재조회하는 동안에도 홈을 유지한다(스피너 깜빡임/리마운트 방지).
  const usedCache = useRef<string | null>(null);

  if (!userId) return { step: 'login', pendingInvite: null, error: false, offline: false, retry };

  if (!q.data) {
    const unreachable =
      q.fetchStatus === 'paused' ||
      (q.isError && q.fetchStatus === 'idle' && isNetworkError(q.error)) ||
      (usedCache.current === userId && q.fetchStatus === 'fetching');
    if (unreachable) {
      if (flag?.userId !== userId) {
        // 표시를 읽는 중: 오프라인 화면을 잠깐 보여 주지 않도록 로딩으로 둔다.
        return { step: null, pendingInvite: null, error: false, offline: false, retry };
      }
      if (flag.ok && (families?.length ?? 0) > 0) {
        usedCache.current = userId;
        return { step: 'ready', pendingInvite: null, error: false, offline: false, retry };
      }
    }
  }

  // 이미 확인한 상태가 있으면 백그라운드 재조회 실패로 앱을 오류 화면으로 바꾸지 않는다.
  if (q.isError && !q.data) {
    return { step: null, pendingInvite: null, error: true, offline: false, retry };
  }
  return {
    step: q.data?.step ?? null,
    pendingInvite: q.data?.pendingInvite ?? null,
    error: false,
    offline: !q.data && q.fetchStatus === 'paused',
    retry,
  };
}

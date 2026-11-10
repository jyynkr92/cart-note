import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { createFamily, fetchMyFamilies } from '@/src/groups/group-api';
import { qk } from '@/src/lib/query-keys';
import { getPendingInvite } from './pending-invite';
import { hasProfile } from './profile-api';
import { resolveOnboarding, type OnboardingStep } from './resolve-onboarding';

export const PERSONAL_GROUP_NAME = '내 장보기';

type State = {
  step: OnboardingStep | null; // null = 로딩 중
  pendingInvite: string | null;
  error: boolean;
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

async function resolveForUser(userId: string): Promise<Resolved> {
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
    return { step: 'ready', pendingInvite: pending };
  }
  return { step: next, pendingInvite: pending };
}

/**
 * 가드용 상태 조회. 사용자별 query key라서 계정이 바뀌면 상태가 섞이지 않고,
 * 프로필 저장/그룹 참여 후 `qk.onboarding(userId)`를 무효화하면 리마운트 없이 다음 단계로 넘어간다.
 */
export function useOnboarding(userId: string | null): State {
  const q = useQuery({
    queryKey: qk.onboarding(userId ?? ''),
    queryFn: () => resolveForUser(userId!),
    enabled: !!userId,
    retry: false,
    staleTime: 0,
  });
  const { refetch } = q;
  const retry = useCallback(() => void refetch(), [refetch]);

  if (!userId) return { step: 'login', pendingInvite: null, error: false, retry };
  if (q.isError) return { step: null, pendingInvite: null, error: true, retry };
  return {
    step: q.data?.step ?? null,
    pendingInvite: q.data?.pendingInvite ?? null,
    error: false,
    retry,
  };
}

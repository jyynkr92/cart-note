import { useCallback, useEffect, useRef, useState } from 'react';
import { createFamily, fetchMyFamilies } from '@/src/groups/group-api';
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

/** 가드용 상태 조회. (Task 7에서 TanStack Query로 교체 가능하도록 작게 유지) */
export function useOnboarding(userId: string | null): State {
  const [step, setStep] = useState<OnboardingStep | null>(null);
  const [pendingInvite, setPending] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const creating = useRef<Promise<unknown> | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setStep('login');
      return;
    }
    setError(false);
    (async () => {
      try {
        const [profile, pending, families] = await Promise.all([
          hasProfile(userId),
          getPendingInvite(),
          fetchMyFamilies(),
        ]);
        let next = resolveOnboarding({
          hasSession: true,
          hasProfile: profile,
          pendingInvite: pending,
          groupCount: families.length,
        });
        if (cancelled) return;
        setPending(pending);
        if (next === 'create-personal') {
          setStep('create-personal');
          // StrictMode/재렌더로 effect가 두 번 돌아도 createFamily는 한 번만, 결과는 공유
          if (!creating.current) {
            creating.current = createFamily(PERSONAL_GROUP_NAME);
          }
          try {
            await creating.current;
          } catch (e) {
            creating.current = null;
            throw e;
          }
          next = 'ready';
        }
        if (!cancelled) setStep(next);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, attempt]);

  const retry = useCallback(() => {
    setStep(null);
    setAttempt((n) => n + 1);
  }, []);

  return { step, pendingInvite, error, retry };
}

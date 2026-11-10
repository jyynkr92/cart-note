export type OnboardingStep = 'login' | 'profile' | 'join-pending' | 'create-personal' | 'ready';

export function resolveOnboarding(s: {
  hasSession: boolean;
  hasProfile: boolean;
  pendingInvite: string | null;
  groupCount: number;
}): OnboardingStep {
  if (!s.hasSession) return 'login';
  if (!s.hasProfile) return 'profile';
  if (s.groupCount >= 1) return 'ready';
  if (s.pendingInvite) return 'join-pending';
  return 'create-personal';
}

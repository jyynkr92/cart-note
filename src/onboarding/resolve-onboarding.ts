export type OnboardingStep = 'login' | 'profile' | 'join-pending' | 'create-personal' | 'ready';

export function resolveOnboarding(s: {
  hasSession: boolean;
  hasProfile: boolean;
  pendingInvite: string | null;
  groupCount: number;
}): OnboardingStep {
  if (!s.hasSession) return 'login';
  if (!s.hasProfile) return 'profile';
  // 이미 그룹이 있어도 초대 링크로 들어왔으면 먼저 참여 화면을 보여 준다(참여/나중에 하면 대기 코드가 지워진다).
  if (s.pendingInvite) return 'join-pending';
  if (s.groupCount >= 1) return 'ready';
  return 'create-personal';
}

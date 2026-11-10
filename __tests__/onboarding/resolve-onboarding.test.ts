import { resolveOnboarding } from '@/src/onboarding/resolve-onboarding';

const base = { hasSession: true, hasProfile: true, pendingInvite: null, groupCount: 0 };

it('walks through the steps', () => {
  expect(resolveOnboarding({ ...base, hasSession: false })).toBe('login');
  expect(resolveOnboarding({ ...base, hasProfile: false })).toBe('profile');
  expect(resolveOnboarding({ ...base, pendingInvite: '123456' })).toBe('join-pending');
  expect(resolveOnboarding(base)).toBe('create-personal');
  expect(resolveOnboarding({ ...base, groupCount: 1 })).toBe('ready');
});

it('lets existing members stay ready despite a stale pending invite', () => {
  expect(resolveOnboarding({ ...base, pendingInvite: '123456', groupCount: 2 })).toBe('ready');
});

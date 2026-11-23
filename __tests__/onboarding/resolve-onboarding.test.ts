import { resolveOnboarding } from '@/src/onboarding/resolve-onboarding';

const base = { hasSession: true, hasProfile: true, pendingInvite: null, groupCount: 0 };

it('walks through the steps', () => {
  expect(resolveOnboarding({ ...base, hasSession: false })).toBe('login');
  expect(resolveOnboarding({ ...base, hasProfile: false })).toBe('profile');
  expect(resolveOnboarding({ ...base, pendingInvite: '123456' })).toBe('join-pending');
  expect(resolveOnboarding(base)).toBe('create-personal');
  expect(resolveOnboarding({ ...base, groupCount: 1 })).toBe('ready');
});

it('sends existing members with a pending invite to join first', () => {
  expect(resolveOnboarding({ ...base, pendingInvite: '123456', groupCount: 2 })).toBe('join-pending');
});

it('asks for a profile before handling a pending invite', () => {
  expect(resolveOnboarding({ ...base, hasProfile: false, pendingInvite: '123456', groupCount: 1 })).toBe(
    'profile'
  );
});

import { redirectSystemPath } from '@/app/+native-intent';

it('maps auth links to home and passes others through', () => {
  expect(redirectSystemPath({ path: 'cartnote://auth#access_token=x', initial: false })).toBe('/');
  expect(redirectSystemPath({ path: '/auth', initial: true })).toBe('/');
  expect(redirectSystemPath({ path: '/join?code=123456', initial: false })).toBe('/join?code=123456');
});

it('maps join deep links to /join preserving the code', () => {
  expect(redirectSystemPath({ path: 'cartnote://join?code=012345', initial: true })).toBe('/join?code=012345');
  expect(redirectSystemPath({ path: 'cartnote://join', initial: false })).toBe('/join');
  expect(redirectSystemPath({ path: '/join?code=012345', initial: false })).toBe('/join?code=012345');
});

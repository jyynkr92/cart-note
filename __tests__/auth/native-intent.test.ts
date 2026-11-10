import { redirectSystemPath } from '@/app/+native-intent';

it('maps auth links to home and passes others through', () => {
  expect(redirectSystemPath({ path: 'cartnote://auth#access_token=x', initial: false })).toBe('/');
  expect(redirectSystemPath({ path: '/auth', initial: true })).toBe('/');
  expect(redirectSystemPath({ path: '/join?code=123456', initial: false })).toBe('/join?code=123456');
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  capturePendingInvite,
  clearPendingInvite,
  getPendingInvite,
  parseJoinUrl,
  setPendingInvite,
} from '@/src/onboarding/pending-invite';

beforeEach(() => AsyncStorage.clear());

it('stores, reads and clears the code (leading zero preserved)', async () => {
  expect(await getPendingInvite()).toBeNull();
  await setPendingInvite('01234567');
  expect(await getPendingInvite()).toBe('01234567');
  await clearPendingInvite();
  expect(await getPendingInvite()).toBeNull();
});

it('parses only valid join links', () => {
  expect(parseJoinUrl('cartnote://join?code=01234567')).toBe('01234567');
  expect(parseJoinUrl('cartnote://join?code=1234-5678')).toBe('12345678');
  expect(parseJoinUrl('cartnote://join?code=123')).toBeNull();
  expect(parseJoinUrl('cartnote://join?code=123456')).toBeNull();
  expect(parseJoinUrl('cartnote://join')).toBeNull();
  expect(parseJoinUrl('cartnote://auth?code=12345678')).toBeNull();
  expect(parseJoinUrl('https://evil.com/join?code=12345678')).toBeNull();
});

it('captures a valid link and ignores invalid ones', async () => {
  expect(await capturePendingInvite('cartnote://join?code=99999999')).toBe(true);
  expect(await getPendingInvite()).toBe('99999999');
  await clearPendingInvite();
  expect(await capturePendingInvite('cartnote://join?code=abc')).toBe(false);
  expect(await capturePendingInvite(null)).toBe(false);
  expect(await getPendingInvite()).toBeNull();
});

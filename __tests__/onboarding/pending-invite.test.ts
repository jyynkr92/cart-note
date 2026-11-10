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
  await setPendingInvite('012345');
  expect(await getPendingInvite()).toBe('012345');
  await clearPendingInvite();
  expect(await getPendingInvite()).toBeNull();
});

it('parses only valid join links', () => {
  expect(parseJoinUrl('cartnote://join?code=012345')).toBe('012345');
  expect(parseJoinUrl('cartnote://join?code=12-34-56')).toBe('123456');
  expect(parseJoinUrl('cartnote://join?code=123')).toBeNull();
  expect(parseJoinUrl('cartnote://join')).toBeNull();
  expect(parseJoinUrl('cartnote://auth?code=123456')).toBeNull();
  expect(parseJoinUrl('https://evil.com/join?code=123456')).toBeNull();
});

it('captures a valid link and ignores invalid ones', async () => {
  expect(await capturePendingInvite('cartnote://join?code=999999')).toBe(true);
  expect(await getPendingInvite()).toBe('999999');
  await clearPendingInvite();
  expect(await capturePendingInvite('cartnote://join?code=abc')).toBe(false);
  expect(await capturePendingInvite(null)).toBe(false);
  expect(await getPendingInvite()).toBeNull();
});

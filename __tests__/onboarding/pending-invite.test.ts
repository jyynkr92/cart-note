import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PENDING_INVITE_MAX_AGE_MS,
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

describe('expiry (A14)', () => {
  const T0 = 1_800_000_000_000;
  const DAY = 24 * 60 * 60 * 1000;

  it('matches the 7-day invite code lifetime', () => {
    expect(PENDING_INVITE_MAX_AGE_MS).toBe(7 * DAY);
  });

  it('keeps a code captured less than 7 days ago', async () => {
    await setPendingInvite('12345678', T0);
    expect(await getPendingInvite(T0 + 7 * DAY - 1)).toBe('12345678');
  });

  it('treats a code older than 7 days as absent and clears it', async () => {
    await setPendingInvite('12345678', T0);
    expect(await getPendingInvite(T0 + 7 * DAY + 1)).toBeNull();
    // 지워졌으므로 시간을 되돌려도 없다.
    expect(await getPendingInvite(T0)).toBeNull();
  });

  it('records the capture time when a link is captured', async () => {
    expect(await capturePendingInvite('cartnote://join?code=99999999', T0)).toBe(true);
    expect(await getPendingInvite(T0 + DAY)).toBe('99999999');
    expect(await getPendingInvite(T0 + 8 * DAY)).toBeNull();
  });

  it('treats a stored value without a capture time as absent and clears it', async () => {
    await AsyncStorage.setItem('cartnote.pendingInvite', '12345678');
    expect(await getPendingInvite(T0)).toBeNull();
    expect(await AsyncStorage.getItem('cartnote.pendingInvite')).toBeNull();
  });
});

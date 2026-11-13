import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getLastNotified,
  markNotified,
  setGroupCount,
  setOpenCounts,
  setRegionMeta,
} from '@/src/geofence/geofence-store';
import { handleEnter, OPEN_COUNT_TIMEOUT_MS } from '@/src/geofence/handle-enter';

const NOW = 1_800_000_000_000;
const H = 60 * 60 * 1000;

function deps(over: Partial<Parameters<typeof handleEnter>[1]> = {}) {
  return {
    now: NOW,
    hasSession: jest.fn().mockResolvedValue(true),
    fetchOpenCount: jest.fn().mockResolvedValue(6),
    notify: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await setRegionMeta({
    r1: { listId: 'L1', familyId: 'F1', groupName: '부모님댁', placeName: '코스트코 양재점' },
  });
  await setGroupCount(2);
});

it('notifies with the text and data, then records the time', async () => {
  const d = deps();
  await expect(handleEnter('r1', d)).resolves.toBe('notified');
  expect(d.fetchOpenCount).toHaveBeenCalledWith('L1');
  expect(d.notify).toHaveBeenCalledWith('[부모님댁] 코스트코 양재점 근처예요 · 사야 할 것 6개', {
    listId: 'L1',
    familyId: 'F1',
  });
  expect(await getLastNotified()).toEqual({ L1: NOW });
});

it('skips when there is nothing to buy', async () => {
  const d = deps({ fetchOpenCount: jest.fn().mockResolvedValue(0) });
  await expect(handleEnter('r1', d)).resolves.toBe('skipped');
  expect(d.notify).not.toHaveBeenCalled();
  expect(await getLastNotified()).toEqual({});
});

it('skips within the cooldown', async () => {
  await markNotified('L1', NOW - 2 * H);
  const d = deps();
  await expect(handleEnter('r1', d)).resolves.toBe('skipped');
  expect(d.notify).not.toHaveBeenCalled();
  expect(d.fetchOpenCount).not.toHaveBeenCalled();
});

it('falls back to the cached open count when the fetch fails', async () => {
  await setOpenCounts({ L1: 4 });
  const d = deps({ fetchOpenCount: jest.fn().mockRejectedValue(new Error('offline')) });
  await expect(handleEnter('r1', d)).resolves.toBe('notified');
  expect(d.notify).toHaveBeenCalledWith(
    '[부모님댁] 코스트코 양재점 근처예요 · 사야 할 것 4개',
    expect.anything()
  );
});

it('skips when the fetch fails and the cached count is 0', async () => {
  await setOpenCounts({ L1: 0 });
  const d = deps({ fetchOpenCount: jest.fn().mockRejectedValue(new Error('offline')) });
  await expect(handleEnter('r1', d)).resolves.toBe('skipped');
});

it('notifies without a count when the fetch fails and nothing is cached', async () => {
  await setGroupCount(1);
  const d = deps({ fetchOpenCount: jest.fn().mockRejectedValue(new Error('offline')) });
  await expect(handleEnter('r1', d)).resolves.toBe('notified');
  expect(d.notify).toHaveBeenCalledWith('코스트코 양재점 근처예요', { listId: 'L1', familyId: 'F1' });
});

it('skips without a session and never notifies (signed out)', async () => {
  const d = deps({ hasSession: jest.fn().mockResolvedValue(false) });
  await expect(handleEnter('r1', d)).resolves.toBe('skipped');
  expect(d.notify).not.toHaveBeenCalled();
  expect(d.fetchOpenCount).not.toHaveBeenCalled();
});

it('skips when the session check throws', async () => {
  const d = deps({ hasSession: jest.fn().mockRejectedValue(new Error('x')) });
  await expect(handleEnter('r1', d)).resolves.toBe('skipped');
  expect(d.notify).not.toHaveBeenCalled();
});

it('skips a region missing from the metadata', async () => {
  const d = deps();
  await expect(handleEnter('unknown', d)).resolves.toBe('skipped');
  expect(d.notify).not.toHaveBeenCalled();
});

it('does not record the time when the notification fails', async () => {
  const d = deps({ notify: jest.fn().mockRejectedValue(new Error('denied')) });
  await expect(handleEnter('r1', d)).resolves.toBe('skipped');
  expect(await getLastNotified()).toEqual({});
});

describe('slow or unauthorized open-count fetch', () => {
  it('falls back to the cached count when the fetch hangs past the timeout (A9)', async () => {
    await setOpenCounts({ L1: 4 });
    const d = deps({ fetchOpenCount: jest.fn(() => new Promise<number>(() => {})), fetchTimeoutMs: 10 });
    await expect(handleEnter('r1', d)).resolves.toBe('notified');
    expect(d.notify).toHaveBeenCalledWith(
      '[부모님댁] 코스트코 양재점 근처예요 · 사야 할 것 4개',
      expect.anything()
    );
  });

  it('uses a 5 second timeout by default (A9)', () => {
    expect(OPEN_COUNT_TIMEOUT_MS).toBe(5_000);
  });

  it('skips when the fetch fails with an auth error and the session is gone (R3)', async () => {
    await setOpenCounts({ L1: 4 });
    const d = deps({
      hasSession: jest.fn().mockResolvedValueOnce(true).mockResolvedValue(false),
      fetchOpenCount: jest.fn().mockRejectedValue({ code: 'PGRST301', message: 'JWT expired' }),
    });
    await expect(handleEnter('r1', d)).resolves.toBe('skipped');
    expect(d.hasSession).toHaveBeenCalledTimes(2);
    expect(d.notify).not.toHaveBeenCalled();
  });

  it('skips when the session re-check itself throws after an auth error (R3)', async () => {
    const d = deps({
      hasSession: jest.fn().mockResolvedValueOnce(true).mockRejectedValue(new Error('storage')),
      fetchOpenCount: jest.fn().mockRejectedValue({ status: 401, message: 'unauthorized' }),
    });
    await expect(handleEnter('r1', d)).resolves.toBe('skipped');
    expect(d.notify).not.toHaveBeenCalled();
  });

  it('still falls back to the cache on an auth error while signed in (R3)', async () => {
    await setOpenCounts({ L1: 4 });
    const d = deps({
      fetchOpenCount: jest.fn().mockRejectedValue({ code: 'PGRST301', message: 'JWT expired' }),
    });
    await expect(handleEnter('r1', d)).resolves.toBe('notified');
    expect(d.hasSession).toHaveBeenCalledTimes(2);
  });

  it('does not re-check the session for a plain network failure', async () => {
    await setOpenCounts({ L1: 4 });
    const d = deps({ fetchOpenCount: jest.fn().mockRejectedValue(new TypeError('Network request failed')) });
    await expect(handleEnter('r1', d)).resolves.toBe('notified');
    expect(d.hasSession).toHaveBeenCalledTimes(1);
  });
});

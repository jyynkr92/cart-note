import { act, cleanup, renderHook } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import {
  getPendingOpen,
  resetPendingOpen,
  useNotificationResponses,
  useOpenPendingNotification,
} from '@/src/geofence/notification-route';
import { useCurrentGroupStore } from '@/src/groups/current-group-store';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
const mockSetFamilyId = jest.fn();
jest.mock('@/src/groups/current-group-store', () => ({
  useCurrentGroupStore: jest.fn(() => ({ setFamilyId: mockSetFamilyId })),
}));

const N = Notifications as jest.Mocked<typeof Notifications>;
const push = router.push as jest.Mock;

const response = (id: string, data: Record<string, unknown>) =>
  ({ notification: { request: { identifier: id, content: { data } } } }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  resetPendingOpen();
  N.getLastNotificationResponseAsync.mockResolvedValue(null);
});
afterEach(async () => {
  await cleanup();
});

it('records a tapped notification and removes the listener on unmount', async () => {
  const remove = jest.fn();
  let listener!: (r: never) => void;
  N.addNotificationResponseReceivedListener.mockImplementation((l) => {
    listener = l as never;
    return { remove };
  });
  const { unmount } = await renderHook(() => useNotificationResponses());
  await act(async () => listener(response('n1', { listId: 'L1', familyId: 'F1' })));
  expect(getPendingOpen()).toEqual({ listId: 'L1', familyId: 'F1' });
  await unmount();
  expect(remove).toHaveBeenCalled();
});

it('records the cold-start response once, even if the listener repeats it', async () => {
  let listener!: (r: never) => void;
  N.addNotificationResponseReceivedListener.mockImplementation((l) => {
    listener = l as never;
    return { remove: jest.fn() };
  });
  N.getLastNotificationResponseAsync.mockResolvedValue(response('n2', { listId: 'L2', familyId: 'F2' }));
  await renderHook(() => useNotificationResponses());
  await act(async () => {});
  expect(getPendingOpen()).toEqual({ listId: 'L2', familyId: 'F2' });
  resetPendingOpen({ keepHandled: true });
  await act(async () => listener(response('n2', { listId: 'L2', familyId: 'F2' })));
  expect(getPendingOpen()).toBeNull();
});

it('ignores responses without list data', async () => {
  let listener!: (r: never) => void;
  N.addNotificationResponseReceivedListener.mockImplementation((l) => {
    listener = l as never;
    return { remove: jest.fn() };
  });
  await renderHook(() => useNotificationResponses());
  await act(async () => listener(response('n3', { foo: 1 })));
  expect(getPendingOpen()).toBeNull();
});

describe('useOpenPendingNotification', () => {
  const fams = [{ id: 'F1' }, { id: 'F2' }];

  it('waits until the app is ready, then switches group and opens the list once', async () => {
    let listener!: (r: never) => void;
    N.addNotificationResponseReceivedListener.mockImplementation((l) => {
      listener = l as never;
      return { remove: jest.fn() };
    });
    await renderHook(() => useNotificationResponses());
    const { rerender } = await renderHook(
      ({ ready }: { ready: boolean }) => useOpenPendingNotification(ready, ready ? fams : undefined),
      { initialProps: { ready: false } }
    );
    await act(async () => listener(response('n4', { listId: 'L1', familyId: 'F2' })));
    expect(push).not.toHaveBeenCalled();

    await rerender({ ready: true });
    expect(mockSetFamilyId).toHaveBeenCalledWith('F2');
    expect(push).toHaveBeenCalledWith({ pathname: '/list/[id]', params: { id: 'L1' } });
    expect(getPendingOpen()).toBeNull();

    await rerender({ ready: true });
    expect(push).toHaveBeenCalledTimes(1);
    expect(useCurrentGroupStore).toHaveBeenCalled();
  });

  it('drops a notification for a group the user is no longer in', async () => {
    let listener!: (r: never) => void;
    N.addNotificationResponseReceivedListener.mockImplementation((l) => {
      listener = l as never;
      return { remove: jest.fn() };
    });
    await renderHook(() => useNotificationResponses());
    await renderHook(() => useOpenPendingNotification(true, fams));
    await act(async () => listener(response('n5', { listId: 'L9', familyId: 'gone' })));
    expect(push).not.toHaveBeenCalled();
    expect(mockSetFamilyId).not.toHaveBeenCalled();
    expect(getPendingOpen()).toBeNull();
  });
});

import { GroupError } from '@/src/groups/group-api';
import { isNetworkError } from '@/src/lib/network-error';

jest.mock('@/src/lib/supabase', () => ({ supabase: {} }));

it('treats fetch failures as network errors', () => {
  expect(isNetworkError(new TypeError('Network request failed'))).toBe(true);
  expect(isNetworkError({ message: 'TypeError: Network request failed', code: '' })).toBe(true);
  expect(isNetworkError({ name: 'AuthRetryableFetchError', message: 'x' })).toBe(true);
});

it('follows the cause of a wrapped error', () => {
  expect(isNetworkError(new GroupError('network', new TypeError('Failed to fetch')))).toBe(true);
});

it('does not treat server responses as network errors', () => {
  expect(isNetworkError({ code: '42501', message: 'permission denied for table items' })).toBe(false);
  expect(isNetworkError(new GroupError('network', { code: 'P0001', message: 'boom' }))).toBe(false);
  expect(isNetworkError(new GroupError('network'))).toBe(false);
  expect(isNetworkError(null)).toBe(false);
});

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

describe('narrowed patterns (B7)', () => {
  it('ignores unrelated TypeErrors (programming errors)', () => {
    expect(isNetworkError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isNetworkError({ message: 'TypeError: x is not a function' })).toBe(false);
  });

  it('ignores a postgres statement timeout (the server answered)', () => {
    expect(
      isNetworkError({ code: '57014', message: 'canceling statement due to statement timeout' })
    ).toBe(false);
  });

  it('accepts aborts and timeouts from our own AbortSignal', () => {
    expect(isNetworkError(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))).toBe(true);
    expect(isNetworkError(Object.assign(new Error('signal timed out'), { name: 'TimeoutError' }))).toBe(true);
    expect(isNetworkError({ message: 'AbortError: The operation was aborted' })).toBe(true);
  });

  it('still accepts fetch failures in RN, browsers and postgrest wrappers', () => {
    expect(isNetworkError(new TypeError('Network request failed'))).toBe(true);
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError({ message: 'TypeError: Network request failed', code: '' })).toBe(true);
  });
});

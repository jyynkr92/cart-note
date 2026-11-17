import { probeBackend } from '@/src/lib/backend-probe';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

it('is reachable on any HTTP response, unreachable when fetch throws (I-2)', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 401 })) as never;
  await expect(probeBackend('http://x', 'k')).resolves.toBe(true);
  expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toBe('http://x/auth/v1/health');
  globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed')) as never;
  await expect(probeBackend('http://x', 'k')).resolves.toBe(false);
});

it('treats a missing URL as unreachable', async () => {
  globalThis.fetch = jest.fn() as never;
  await expect(probeBackend('', 'k')).resolves.toBe(false);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

import type { QueryClient } from '@tanstack/react-query';

/** QueryClient.clear()는 mutation의 gc 타이머를 멈추지 않으므로(오래 남음) 먼저 destroy한다. */
export function disposeClient(client: QueryClient): void {
  for (const m of client.getMutationCache().getAll()) m.destroy();
  client.clear();
}

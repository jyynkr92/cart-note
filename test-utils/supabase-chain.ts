/**
 * supabase-js 쿼리 빌더 흉내. 어떤 메서드를 불러도 자기 자신을 돌려주고, await하면 result로 끝난다.
 * calls에 [메서드, 인자] 순서가 남는다.
 */
export function chain(result: unknown): {
  builder: unknown;
  calls: [string, unknown[]][];
} {
  const calls: [string, unknown[]][] = [];
  const builder: unknown = new Proxy(
    {},
    {
      get(_t, key) {
        if (key === 'then') {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(result).then(res, rej);
        }
        return (...args: unknown[]) => {
          calls.push([String(key), args]);
          return builder;
        };
      },
    }
  );
  return { builder, calls };
}

import { useCallback, useMemo, useState } from 'react';

/** 목록 상세의 항목 다중 선택 상태. 화면 로컬 상태이며 영속화하지 않는다. */
export function useSelection() {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  const start = useCallback((id: string) => setSelected(new Set([id])), []);
  const toggle = useCallback(
    (id: string) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    []
  );
  const clear = useCallback(() => setSelected((prev) => (prev.size ? new Set() : prev)), []);
  /** 더 이상 존재하지 않는 id를 선택에서 뺀다. 바뀐 게 없으면 상태를 그대로 둔다. */
  const retain = useCallback(
    (validIds: readonly string[]) =>
      setSelected((prev) => {
        const valid = new Set(validIds);
        const next = new Set([...prev].filter((id) => valid.has(id)));
        return next.size === prev.size ? prev : next;
      }),
    []
  );

  return useMemo(
    () => ({ selected, active: selected.size > 0, toggle, start, clear, retain }),
    [selected, toggle, start, clear, retain]
  );
}

import type { Item } from './item-api';

const time = (s: string | null) => (s ? Date.parse(s) : 0);

export function sortItems(items: Item[]): { open: Item[]; done: Item[] } {
  const open = items
    .filter((i) => !i.is_done)
    .sort((a, b) => a.sort_order - b.sort_order || time(b.created_at) - time(a.created_at));
  const done = items.filter((i) => i.is_done).sort((a, b) => time(b.done_at) - time(a.done_at));
  return { open, done };
}

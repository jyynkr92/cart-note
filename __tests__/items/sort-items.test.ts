import { sortItems } from '@/src/items/sort-items';
import type { Item } from '@/src/items/item-api';

jest.mock('@/src/lib/supabase', () => ({ supabase: {} }));

const item = (id: string, over: Partial<Item> = {}): Item => ({
  id,
  list_id: 'l1',
  family_id: 'f1',
  name: id,
  note: null,
  is_done: false,
  done_at: null,
  sort_order: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  created_by: null,
  ...over,
});

it('splits open and done items', () => {
  const { open, done } = sortItems([
    item('a'),
    item('b', { is_done: true, done_at: '2026-01-02T00:00:00.000Z' }),
  ]);
  expect(open.map((i) => i.id)).toEqual(['a']);
  expect(done.map((i) => i.id)).toEqual(['b']);
});

it('sorts open by sort_order asc, ties by created_at desc', () => {
  const { open } = sortItems([
    item('old', { sort_order: 1, created_at: '2026-01-01T00:00:00.000Z' }),
    item('new', { sort_order: 1, created_at: '2026-01-03T00:00:00.000Z' }),
    item('first', { sort_order: 0, created_at: '2026-01-02T00:00:00.000Z' }),
  ]);
  expect(open.map((i) => i.id)).toEqual(['first', 'new', 'old']);
});

it('sorts done by done_at desc and does not mutate the input', () => {
  const input = [
    item('d1', { is_done: true, done_at: '2026-01-02T00:00:00.000Z' }),
    item('d2', { is_done: true, done_at: '2026-01-05T00:00:00.000Z' }),
    item('d3', { is_done: true, done_at: '2026-01-03T00:00:00.000Z' }),
  ];
  const copy = [...input];
  expect(sortItems(input).done.map((i) => i.id)).toEqual(['d2', 'd3', 'd1']);
  expect(input).toEqual(copy);
});

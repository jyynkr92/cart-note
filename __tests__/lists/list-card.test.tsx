import { render, screen } from '@testing-library/react-native';
import { ListCard, moveId } from '@/src/lists/ListCard';
import type { List } from '@/src/lists/list-api';

const list = (o: Partial<List> & Pick<List, 'id' | 'name'>): List => ({
  family_id: 'g1',
  kind: 'store',
  sort_order: 0,
  created_at: '2026-01-01T00:00:00Z',
  ...o,
});

describe('moveId', () => {
  it('moves an id down', () => {
    expect(moveId(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });
  it('moves an id up', () => {
    expect(moveId(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });
  it('keeps the order when dropped in place', () => {
    expect(moveId(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });
  it('does not change the input', () => {
    const ids = ['a', 'b', 'c'];
    moveId(ids, 0, 2);
    expect(ids).toEqual(['a', 'b', 'c']);
  });
});

describe('ListCard type mark', () => {
  it('marks a store list as 마트 and keeps the location marker', async () => {
    await render(
      <ListCard list={list({ id: 'l1', name: '이마트', has_location: true })} onPress={jest.fn()} />
    );
    expect(screen.getByLabelText('마트')).toBeTruthy();
    expect(screen.queryByLabelText('온라인')).toBeNull();
    expect(screen.getByText('📍')).toBeTruthy();
  });

  it('marks an online list as 온라인', async () => {
    await render(
      <ListCard list={list({ id: 'l2', name: '쿠팡', kind: 'online' })} onPress={jest.fn()} />
    );
    expect(screen.getByLabelText('온라인')).toBeTruthy();
    expect(screen.queryByLabelText('마트')).toBeNull();
  });

  it('shows no type mark for the inbox', async () => {
    await render(
      <ListCard list={list({ id: 'l0', name: '사야할것', kind: 'inbox' })} onPress={jest.fn()} />
    );
    expect(screen.queryByLabelText('마트')).toBeNull();
    expect(screen.queryByLabelText('온라인')).toBeNull();
  });
});

import { fireEvent, render, screen } from '@testing-library/react-native';
import { ItemEditSheet } from '@/src/items/ItemEditSheet';
import type { Item } from '@/src/items/item-api';

const base = {
  list_id: 'l1',
  family_id: 'f1',
  done: false,
  created_at: '2026-01-01T00:00:00Z',
} as unknown as Item;
const itemA = { ...base, id: 'a', name: 'A 이름', note: 'A 메모' } as Item;
const itemB = { ...base, id: 'b', name: 'B 이름', note: null } as Item;

describe('ItemEditSheet', () => {
  it('switching from item A to item B shows B values', async () => {
    const { rerender } = await render(
      <ItemEditSheet item={itemA} onClose={jest.fn()} onSave={jest.fn()} />
    );
    expect(screen.getByDisplayValue('A 이름')).toBeTruthy();
    await rerender(<ItemEditSheet item={null} onClose={jest.fn()} onSave={jest.fn()} />);
    await rerender(<ItemEditSheet item={itemB} onClose={jest.fn()} onSave={jest.fn()} />);
    expect(screen.getByDisplayValue('B 이름')).toBeTruthy();
    expect(screen.queryByDisplayValue('A 이름')).toBeNull();
  });

  it('save sends trimmed name and note', async () => {
    const onSave = jest.fn();
    await render(<ItemEditSheet item={itemA} onClose={jest.fn()} onSave={onSave} />);
    await fireEvent.changeText(screen.getByDisplayValue('A 이름'), '  새 이름  ');
    await fireEvent.changeText(screen.getByDisplayValue('A 메모'), '  새 메모 ');
    await fireEvent.press(screen.getByRole('button', { name: '저장' }));
    expect(onSave).toHaveBeenCalledWith({ id: 'a', name: '새 이름', note: '새 메모' });
  });
});

import { render, screen } from '@testing-library/react-native';

import Home from '@/app/(app)/index';

describe('Home', () => {
  it('앱 이름을 보여준다', async () => {
    await render(<Home />);
    expect(screen.getByText('Cart Note')).toBeTruthy();
  });
});

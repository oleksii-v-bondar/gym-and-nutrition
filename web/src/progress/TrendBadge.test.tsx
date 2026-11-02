import { render, screen } from '@testing-library/react';
import { TrendBadge } from './TrendBadge';

it('renders progressing with an up arrow', () => {
  render(<TrendBadge label="progressing" />);
  expect(screen.getByText(/progressing/i)).toBeInTheDocument();
  expect(screen.getByText(/▲/)).toBeInTheDocument();
});
it('renders insufficient as a friendly message', () => {
  render(<TrendBadge label="insufficient" />);
  expect(screen.getByText(/not enough data/i)).toBeInTheDocument();
});

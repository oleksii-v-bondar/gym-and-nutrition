import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { NavBar } from './NavBar';
import * as AuthCtx from '../auth/AuthContext';

it('opens a burger drawer and logs out from it', async () => {
  const logout = vi.fn();
  vi.spyOn(AuthCtx, 'useAuth').mockReturnValue({ isAuthed: true, isAdmin: false, login: vi.fn(), register: vi.fn(), logout });
  render(<MemoryRouter><NavBar /></MemoryRouter>);

  expect(screen.queryByTestId('nav-drawer')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: /menu/i }));
  const drawer = screen.getByTestId('nav-drawer');
  expect(within(drawer).getByRole('button', { name: /plans/i })).toBeInTheDocument();
  expect(within(drawer).getByRole('button', { name: /history/i })).toBeInTheDocument();

  await userEvent.click(within(drawer).getByRole('button', { name: /log out/i }));
  expect(logout).toHaveBeenCalled();
  expect(screen.queryByTestId('nav-drawer')).toBeNull();
});

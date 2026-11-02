import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import * as AuthCtx from './AuthContext';

it('submits login and password to login', async () => {
  const login = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(AuthCtx, 'useAuth').mockReturnValue({ isAuthed: false, isAdmin: false, login, register: vi.fn(), logout: vi.fn() });
  render(<MemoryRouter><LoginPage /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText(/login/i), 'alice');
  await userEvent.type(screen.getByLabelText(/password/i), 'pw123456');
  await userEvent.click(screen.getByRole('button', { name: /log in/i }));
  expect(login).toHaveBeenCalledWith('alice', 'pw123456');
});

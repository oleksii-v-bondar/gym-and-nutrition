import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import * as AuthCtx from './AuthContext';

it('submits email and password to login', async () => {
  const login = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(AuthCtx, 'useAuth').mockReturnValue({ isAuthed: false, login, register: vi.fn(), logout: vi.fn() });
  render(<MemoryRouter><LoginPage /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText(/email/i), 'a@x.com');
  await userEvent.type(screen.getByLabelText(/password/i), 'pw123456');
  await userEvent.click(screen.getByRole('button', { name: /log in/i }));
  expect(login).toHaveBeenCalledWith('a@x.com', 'pw123456');
});

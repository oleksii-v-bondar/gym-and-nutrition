import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
export function NavBar() {
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const items = () => (
    <>
      <Link to="/" onClick={close}><button className="secondary">Plans</button></Link>
      <Link to="/history" onClick={close}><button className="secondary">History</button></Link>
      <button className="secondary" onClick={() => { close(); logout(); }}>Log out</button>
    </>
  );
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="nav-desktop">{items()}</div>
      <button className="secondary nav-burger" aria-label="Menu" onClick={() => setOpen(true)}>☰</button>
      {open && (
        <>
          <div className="nav-backdrop" onClick={close} />
          <div className="nav-drawer" data-testid="nav-drawer">{items()}</div>
        </>
      )}
    </div>
  );
}

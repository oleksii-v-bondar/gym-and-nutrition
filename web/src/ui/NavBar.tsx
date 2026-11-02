import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
export function NavBar() {
  const { logout } = useAuth();
  return (
    <div className="row" style={{ marginBottom: 12 }}>
      <Link to="/"><button className="secondary">Plans</button></Link>
      <button className="secondary" onClick={logout}>Log out</button>
    </div>
  );
}

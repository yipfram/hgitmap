import { useState } from 'react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import useAuthConfig from '../hooks/useAuthConfig';
import { useAuth } from '../context/AuthContext';
import HeatmapLogo from '../components/HeatmapLogo';
import ThemeToggle from '../components/ThemeToggle';
import useDocumentTitle from '../hooks/useDocumentTitle';
import './Auth.css';

const Register = () => {
  useDocumentTitle('Register');
  const authConfig = useAuthConfig();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { user, register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      const data = await register(username, password);
      navigate(`/${data.username}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (user) {
    return <Navigate to={`/${user.username}`} replace />;
  }

  if (authConfig.loaded && !authConfig.password_login) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="auth-container">
      <div className="theme-toggle-wrapper">
        <ThemeToggle />
      </div>
      <div className="auth-box">
        <Link to="/" aria-label="Hgitmap home" style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
          <HeatmapLogo size={48} />
        </Link>
        <h1>Register for Hgitmap</h1>
        <form onSubmit={handleSubmit}>
          {error && <div className="error-message" role="alert">{error}</div>}

          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              type="text"
              id="username"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              name="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm Password</label>
            <input
              type="password"
              id="confirmPassword"
              name="confirmPassword"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <button type="submit" disabled={loading}>
            {loading ? 'Registering...' : 'Register'}
          </button>
        </form>

        <div className="auth-footer">
          Already have an account? <Link to="/login">Login</Link>
        </div>
      </div>
    </div>
  );
};

export default Register;

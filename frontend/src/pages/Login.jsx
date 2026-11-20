import { useState } from 'react';
import { useNavigate, useSearchParams, useLocation, Link, Navigate } from 'react-router-dom';
import apiClient from '../api/client';
import useAuthConfig from '../hooks/useAuthConfig';
import { useAuth } from '../context/AuthContext';
import HeatmapLogo from '../components/HeatmapLogo';
import ThemeToggle from '../components/ThemeToggle';
import './Auth.css';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [searchParams] = useSearchParams();
  const [error, setError] = useState(searchParams.get('error') || '');
  const authConfig = useAuthConfig();
  const [loading, setLoading] = useState(false);
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const fromState = location.state?.from;
  const from = fromState?.pathname && fromState.pathname.startsWith('/') && !fromState.pathname.startsWith('//')
    ? `${fromState.pathname}${fromState.search || ''}${fromState.hash || ''}`
    : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await login(username, password);
      navigate(from || `/${data.username}`, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (user) {
    return <Navigate to={from || `/${user.username}`} replace />;
  }

  return (
    <div className="auth-container">
      <div className="theme-toggle-wrapper">
        <ThemeToggle />
      </div>
      <div className="auth-box">
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
          <HeatmapLogo size={48} />
        </div>
        <h1>Login to Hgitmap</h1>
        {!authConfig.password_login && error && <div className="error-message">{error}</div>}
        {authConfig.oidc_enabled && (
          <button
            type="button"
            className="sso-button"
            onClick={() => { window.location.href = apiClient.oidcLoginUrl(); }}
          >
            Continue with {authConfig.oidc_name}
          </button>
        )}
        {authConfig.oidc_enabled && authConfig.password_login && (
          <div className="auth-divider">or</div>
        )}
        {authConfig.password_login && (
        <form onSubmit={handleSubmit}>
          {error && <div className="error-message">{error}</div>}

          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              type="text"
              id="username"
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
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <button type="submit" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
        )}

        {authConfig.password_login && (
          <div className="auth-footer">
            Don't have an account? <Link to="/register">Register</Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default Login;

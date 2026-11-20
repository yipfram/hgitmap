import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Landing page after the backend finished the OIDC flow. The JWT arrives in the URL fragment.
function OidcCallback() {
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = params.get('token');
    const username = params.get('username');
    // Drop the token from the address bar / history immediately.
    window.history.replaceState(null, '', window.location.pathname);

    if (!token || !username) {
      setError('Invalid login response. Please try again.');
      return;
    }
    const u = loginWithToken({
      token,
      user_id: params.get('user_id'),
      username,
      is_admin: params.get('is_admin') === 'true',
    });
    navigate(`/${u.username}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="auth-container">
        <div className="auth-box">
          <div className="error-message" role="alert">{error}</div>
          <div className="auth-footer"><a href="/login">Back to login</a></div>
        </div>
      </div>
    );
  }
  return null;
}

export default OidcCallback;

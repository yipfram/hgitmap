import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import apiClient from '../api/client';
import { useAuth } from '../context/AuthContext';
import useDocumentTitle from '../hooks/useDocumentTitle';
import Profile from './Profile';
import NotFound from './NotFound';

// Checks that the user exists before rendering the profile; renders a 404 otherwise.
const ProfileRoute = () => {
  const { username } = useParams();
  const { user } = useAuth();
  const isSelf = user?.username === username;
  const [status, setStatus] = useState({ username: null, state: 'loading' });

  useEffect(() => {
    if (isSelf) return undefined;
    let cancelled = false;
    apiClient
      .getUserStats(username)
      .then(() => !cancelled && setStatus({ username, state: 'found' }))
      .catch((err) => {
        if (cancelled) return;
        // Only a definite "not found" shows the 404; other errors are left to the profile page
        const missing = /not found/i.test(err?.message || '');
        setStatus({ username, state: missing ? 'missing' : 'found' });
      });
    return () => {
      cancelled = true;
    };
  }, [username, isSelf]);

  const state = isSelf ? 'found' : status.username === username ? status.state : 'loading';
  useDocumentTitle(state === 'found' ? username : null);

  if (state === 'loading') return null;
  if (state === 'missing') {
    return <NotFound title="User not found" message={`There is no user named "${username}".`} />;
  }
  return <Profile />;
};

export default ProfileRoute;

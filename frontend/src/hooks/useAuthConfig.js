import { useEffect, useState } from 'react';
import apiClient from '../api/client';

const DEFAULT_CONFIG = { password_login: true, oidc_enabled: false, oidc_name: null };

// Which login methods the backend offers. `loaded` is false until the first response.
export default function useAuthConfig() {
  const [config, setConfig] = useState({ ...DEFAULT_CONFIG, loaded: false });

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getAuthConfig()
      .then((c) => !cancelled && setConfig({ ...c, loaded: true }))
      .catch(() => !cancelled && setConfig({ ...DEFAULT_CONFIG, loaded: true }));
    return () => {
      cancelled = true;
    };
  }, []);

  return config;
}

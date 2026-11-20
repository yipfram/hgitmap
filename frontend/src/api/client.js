const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

// Read a response body without assuming it is JSON
async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(data, response, fallback) {
  if (data && typeof data === 'object' && data.error) return data.error;
  if (typeof data === 'string' && data.trim()) return data.trim();
  return response.statusText || fallback;
}

class ApiClient {
  constructor() {
    this.isHandlingExpiration = false;
    this.onSessionExpired = null; // Callback for session expiration
  }

  setSessionExpiredCallback(callback) {
    this.onSessionExpired = callback;
  }
  async register(username, password) {
    const response = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });

    const data = await parseBody(response);

    if (!response.ok) {
      throw new Error(errorMessage(data, response, 'Registration failed'));
    }

    return data;
  }

  async getAuthConfig() {
    const response = await fetch(`${API_BASE_URL}/auth/config`);
    if (!response.ok) {
      return { password_login: true, oidc_enabled: false, oidc_name: null };
    }
    return response.json();
  }

  oidcLoginUrl() {
    return `${API_BASE_URL}/auth/oidc/login`;
  }

  async login(username, password) {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });

    const data = await parseBody(response);

    if (!response.ok) {
      throw new Error(errorMessage(data, response, 'Login failed'));
    }

    return data;
  }

  async fetchWithAuth(url, options = {}) {
    const token = localStorage.getItem('token');

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}${url}`, {
      ...options,
      headers,
    });

    // Only treat 401 as an expired session when we actually sent a token
    if (response.status === 401 && token) {
      // Only handle expiration once, even if multiple API calls fail simultaneously
      if (!this.isHandlingExpiration) {
        this.isHandlingExpiration = true;
        localStorage.removeItem('token');
        localStorage.removeItem('user');

        if (this.onSessionExpired) {
          this.onSessionExpired();
        }

        // Wait 3 seconds to let user see the toast message before redirect
        setTimeout(() => {
          window.location.href = '/login';
        }, 3000);
      }

      throw new Error('Your session has expired. Please log in again.');
    }

    // Handle 204 No Content responses (like DELETE)
    if (response.status === 204) {
      return null;
    }

    const data = await parseBody(response);

    if (!response.ok) {
      throw new Error(errorMessage(data, response, 'Request failed'));
    }

    return data;
  }

  // Platform Management
  async connectPlatform(platform, accessToken, instanceUrl = null) {
    return this.fetchWithAuth('/platforms/connect', {
      method: 'POST',
      body: JSON.stringify({ platform, access_token: accessToken, instance_url: instanceUrl }),
    });
  }

  async listPlatforms() {
    return this.fetchWithAuth('/platforms');
  }

  async getPlatforms() {
    return this.listPlatforms();
  }

  async disconnectPlatform(platformId) {
    return this.fetchWithAuth(`/platforms/${platformId}`, {
      method: 'DELETE',
    });
  }

  async updatePlatformToken(platformId, accessToken) {
    return this.fetchWithAuth(`/platforms/${platformId}`, {
      method: 'PUT',
      body: JSON.stringify({ access_token: accessToken }),
    });
  }

  async syncPlatform(platformId, allYears = false, year = null, profileOnly = false) {
    let queryParams = [];

    if (profileOnly) {
      queryParams.push('profile_only=true');
    } else {
      if (allYears) {
        queryParams.push('all_years=true');
      } else if (year) {
        queryParams.push(`year=${year}`);
      }
    }

    const queryString = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';

    return this.fetchWithAuth(`/platforms/${platformId}/sync${queryString}`, {
      method: 'POST',
    });
  }

  async syncPlatformAsync(platformId, allYears = false, year = null, profileOnly = false) {
    const queryParams = [];
    if (allYears) {
      queryParams.push('all_years=true');
    } else if (year) {
      queryParams.push(`year=${year}`);
    }
    if (profileOnly) {
      queryParams.push('profile_only=true');
    }

    const queryString = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';

    return this.fetchWithAuth(`/platforms/${platformId}/sync-async${queryString}`, {
      method: 'POST',
    });
  }

  async getSyncJobStatus(jobId) {
    return this.fetchWithAuth(`/platforms/sync-jobs/${jobId}`);
  }

  async listPlatformSyncJobs(status = null, limit = 50) {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    params.append('limit', limit.toString());

    const queryString = params.toString();
    return this.fetchWithAuth(`/platforms/sync-jobs?${queryString}`);
  }

  async cancelSyncJob(jobId) {
    return this.fetchWithAuth(`/platforms/sync-jobs/${jobId}`, {
      method: 'DELETE',
    });
  }

  async deleteSyncJob(jobId) {
    return this.fetchWithAuth(`/platforms/sync-jobs/${jobId}/delete`, {
      method: 'DELETE',
    });
  }

  async updatePlatformSyncPreferences(platformId, preferences) {
    return this.fetchWithAuth(`/platforms/${platformId}/sync-preferences`, {
      method: 'PUT',
      body: JSON.stringify(preferences),
    });
  }

  // Contributions
  async getContributions(from = null, to = null, platform = null) {
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    if (platform) params.append('platform', platform);

    const queryString = params.toString();
    const url = queryString ? `/contributions?${queryString}` : '/contributions';

    return this.fetchWithAuth(url);
  }

  async getContributionStats() {
    return this.fetchWithAuth('/contributions/stats');
  }

  // Activities
  async getActivities(from = null, to = null, limit = 50, offset = 0, platform = null) {
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    params.append('limit', limit.toString());
    params.append('offset', offset.toString());
    if (platform) params.append('platform', platform);

    const queryString = params.toString();
    const url = `/activities?${queryString}`;

    return this.fetchWithAuth(url);
  }

  // Settings
  async getSettings() {
    return this.fetchWithAuth('/settings');
  }

  async updateSettings(settings) {
    return this.fetchWithAuth('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  // OAuth
  async startGithubOAuth() {
    const response = await this.fetchWithAuth('/oauth/github/authorize');
    return response.authorization_url;
  }

  async startGiteaOAuth(instanceUrl) {
    const response = await this.fetchWithAuth(`/oauth/gitea/authorize?instance_url=${encodeURIComponent(instanceUrl)}`);
    return response.authorization_url;
  }

  async startGitlabOAuth(instanceUrl = null) {
    const url = instanceUrl
      ? `/oauth/gitlab/authorize?instance_url=${encodeURIComponent(instanceUrl)}`
      : '/oauth/gitlab/authorize';
    const response = await this.fetchWithAuth(url);
    return response.authorization_url;
  }

  async listOAuthInstances(platform) {
    // This is a public endpoint, but we still use fetchWithAuth for consistency
    const response = await this.fetchWithAuth(`/oauth/instances/${platform}`);
    return response;
  }

  // Admin - OAuth Apps Management
  async listOAuthApps() {
    return this.fetchWithAuth('/admin/oauth-apps');
  }

  async createOAuthApp(platform, instanceName, instanceUrl, clientId, clientSecret, isDefault = true) {
    return this.fetchWithAuth('/admin/oauth-apps', {
      method: 'POST',
      body: JSON.stringify({
        platform,
        instance_name: instanceName,
        instance_url: instanceUrl || '',
        client_id: clientId,
        client_secret: clientSecret,
        is_default: isDefault,
        is_enabled: true,
      }),
    });
  }

  async updateOAuthApp(appId, updates) {
    return this.fetchWithAuth(`/admin/oauth-apps/${appId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteOAuthApp(appId) {
    return this.fetchWithAuth(`/admin/oauth-apps/${appId}`, {
      method: 'DELETE',
    });
  }

  // Heatmap Themes
  async listThemes() {
    return this.fetchWithAuth('/heatmap/themes');
  }

  async getTheme(slug) {
    return this.fetchWithAuth(`/heatmap/themes/${slug}`);
  }

  async createTheme(themeData) {
    return this.fetchWithAuth('/heatmap/themes', {
      method: 'POST',
      body: JSON.stringify(themeData),
    });
  }

  async updateTheme(slug, themeData) {
    return this.fetchWithAuth(`/heatmap/themes/${slug}`, {
      method: 'PUT',
      body: JSON.stringify(themeData),
    });
  }

  async deleteTheme(slug) {
    return this.fetchWithAuth(`/heatmap/themes/${slug}`, {
      method: 'DELETE',
    });
  }

  async setDefaultTheme(slug) {
    return this.fetchWithAuth(`/heatmap/themes/${slug}/set-default`, {
      method: 'POST',
    });
  }

  async duplicateTheme(slug, newName, newSlug) {
    return this.fetchWithAuth(`/heatmap/themes/${slug}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ new_name: newName, new_slug: newSlug }),
    });
  }

  // Heatmap Generation Settings
  async getGenerationSettings() {
    return this.fetchWithAuth('/heatmap/settings');
  }

  async updateGenerationSettings(settings) {
    return this.fetchWithAuth('/heatmap/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  // Heatmap Generation
  async triggerGeneration() {
    return this.fetchWithAuth('/heatmap/generate', {
      method: 'POST',
    });
  }

  async triggerThemeGeneration(themeSlug) {
    return this.fetchWithAuth(`/heatmap/generate/${themeSlug}`, {
      method: 'POST',
    });
  }

  async listGeneratedHeatmaps() {
    return this.fetchWithAuth('/heatmap/generated');
  }

  async listGenerationJobs(status = null, limit = 50) {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    params.append('limit', limit.toString());

    const queryString = params.toString();
    return this.fetchWithAuth(`/heatmap/jobs?${queryString}`);
  }

  // Get heatmap embed URL
  getHeatmapEmbedUrl(username, themeSlug, format = 'png') {
    return `${API_BASE_URL}/embed/${username}/${themeSlug}.${format}`;
  }

  // Preview theme with parameters
  async previewTheme(themeData) {
    return this.fetchWithAuth('/heatmap/preview', {
      method: 'POST',
      body: JSON.stringify(themeData),
    });
  }

  // Get available fonts
  async getAvailableFonts() {
    return this.fetchWithAuth('/heatmap/fonts');
  }

  // Platform Sync
  async triggerSync() {
    return this.fetchWithAuth('/sync/trigger', {
      method: 'POST',
    });
  }

  async getSyncStatus() {
    return this.fetchWithAuth('/sync/status');
  }

  // Public user profile endpoints (no authentication required)
  async getUserContributions(username, from = null, to = null, platform = null) {
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    if (platform) params.append('platform', platform);

    const queryString = params.toString();
    const url = queryString
      ? `/users/${username}/contributions?${queryString}`
      : `/users/${username}/contributions`;

    // Use regular fetch without auth
    const response = await fetch(`${API_BASE_URL}${url}`);
    const data = await parseBody(response);

    if (!response.ok) {
      throw new Error(errorMessage(data, response, 'Failed to fetch user contributions'));
    }

    return data;
  }

  async getUserStats(username) {
    // Use regular fetch without auth
    const response = await fetch(`${API_BASE_URL}/users/${username}/contributions/stats`);
    const data = await parseBody(response);

    if (!response.ok) {
      throw new Error(errorMessage(data, response, 'Failed to fetch user stats'));
    }

    return data;
  }

  async getUserPlatforms(username) {
    // Use regular fetch without auth
    const response = await fetch(`${API_BASE_URL}/users/${username}/platforms`);
    const data = await parseBody(response);

    if (!response.ok) {
      throw new Error(errorMessage(data, response, 'Failed to fetch user platforms'));
    }

    return data;
  }

  async getUserActivities(username, from = null, to = null, limit = 50, offset = 0, platform = null) {
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    params.append('limit', limit.toString());
    params.append('offset', offset.toString());
    if (platform) params.append('platform', platform);

    const queryString = params.toString();
    const url = `/users/${username}/activities?${queryString}`;

    // Use regular fetch without auth
    const response = await fetch(`${API_BASE_URL}${url}`);
    const data = await parseBody(response);

    if (!response.ok) {
      throw new Error(errorMessage(data, response, 'Failed to fetch user activities'));
    }

    return data;
  }
}

export default new ApiClient();

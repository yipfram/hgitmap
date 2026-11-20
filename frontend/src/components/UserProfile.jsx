import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import apiClient from '../api/client';
import PlatformIcon from './PlatformIcon';
import './UserProfile.css';

const UserProfile = ({ username = null, isPublic = false }) => {
  const { user: _user } = useAuth();
  const { theme: _theme } = useTheme();
  const [stats, setStats] = useState(null);
  const [platforms, setPlatforms] = useState([]);
  const [selectedPlatform, setSelectedPlatform] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch contribution stats - use public or authenticated API
        const statsData = isPublic
          ? await apiClient.getUserStats(username)
          : await apiClient.getContributionStats();
        setStats(statsData);

        // Fetch platforms - use public or authenticated API
        const platformsData = isPublic
          ? await apiClient.getUserPlatforms(username)
          : await apiClient.getPlatforms();
        setPlatforms(platformsData);
      } catch (error) {
        console.error('Failed to fetch user data:', error);
      }
    };

    fetchData();

    // Listen for platform sync events to refresh profile data (only for authenticated users)
    if (!isPublic) {
      const handlePlatformSynced = () => {
        console.log('Platform synced, refreshing profile data...');
        fetchData();
      };

      window.addEventListener('platformSynced', handlePlatformSynced);

      return () => {
        window.removeEventListener('platformSynced', handlePlatformSynced);
      };
    }
  }, [username, isPublic]);

  // Local fallback avatar: initial on a coloured circle (no external request)
  const getFallbackAvatarUrl = (name) => {
    const label = name || '?';
    let hash = 0;
    for (const ch of label) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const initial = (Array.from(label)[0] || '?').toUpperCase().replace(/[<>&"']/g, '?');
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260" viewBox="0 0 260 260">' +
      `<rect width="260" height="260" fill="hsl(${hash % 360}, 55%, 42%)"/>` +
      '<text x="130" y="130" fill="#fff" font-family="sans-serif" font-size="120" font-weight="700" ' +
      `text-anchor="middle" dominant-baseline="central">${initial}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  };

  // Get platform name
  const getPlatformName = (platformType) => {
    switch (platformType) {
      case 'github':
        return 'GitHub';
      case 'gitlab':
        return 'GitLab';
      case 'gitea':
        return 'Gitea';
      default:
        return platformType;
    }
  };

  return (
    <div className="user-profile">
      {/* Overall Stats Section */}
      {stats && (
        <div className="heatmap-stats">
          <div className="stat-card">
            <div className="stat-label">Total</div>
            <div className="stat-value">{stats.total_contributions?.toLocaleString() || 0} contributions</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Current streak</div>
            <div className="stat-value">{stats.current_streak || 0} days</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Longest streak</div>
            <div className="stat-value">{stats.longest_streak || 0} days</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Platforms</div>
            <div className="stat-value">{stats.active_platforms || 0} connected</div>
          </div>
        </div>
      )}

      {/* Platform Profiles Section */}
      {platforms && platforms.length > 0 && (
        <div className="platform-profiles">
          {/* Platform Tabs */}
          <div className="platform-tabs" role="tablist" aria-label="Platforms">
            {platforms.map((platform, index) => (
              <button
                key={platform.id}
                className={`platform-tab ${selectedPlatform === index ? 'active' : ''}`}
                role="tab"
                aria-selected={selectedPlatform === index}
                onClick={() => setSelectedPlatform(index)}
              >
                <PlatformIcon platform={platform.platform} size={16} />
                <span>{getPlatformName(platform.platform)}</span>
              </button>
            ))}
          </div>

          {/* Selected Platform Profile */}
          <div className="platform-profile-card" role="tabpanel">
            <div className="platform-avatar">
              <img
                src={platforms[selectedPlatform].avatar_url || getFallbackAvatarUrl(platforms[selectedPlatform].platform_username)}
                alt={platforms[selectedPlatform].platform_username}
                className="platform-avatar-img"
                onError={(e) => {
                  e.target.onerror = null;
                  e.target.src = getFallbackAvatarUrl(platforms[selectedPlatform].platform_username);
                }}
              />
            </div>

            <div className="platform-info">
              <div className="vcard-names">
                <h1 className="profile-name-heading">
                  <span className="platform-display-name">
                    {platforms[selectedPlatform].display_name || platforms[selectedPlatform].platform_username}
                  </span>
                  <span className="platform-username">
                    {platforms[selectedPlatform].platform_username}
                  </span>
                </h1>
              </div>

              {platforms[selectedPlatform].bio && (
                <div className="platform-bio">{platforms[selectedPlatform].bio}</div>
              )}

              {(platforms[selectedPlatform].location || platforms[selectedPlatform].company) && (
                <div className="platform-details">
                  {platforms[selectedPlatform].location && (
                    <div className="detail-item">
                      <span className="detail-icon">📍</span>
                      <span className="detail-text">{platforms[selectedPlatform].location}</span>
                    </div>
                  )}

                  {platforms[selectedPlatform].company && (
                    <div className="detail-item">
                      <span className="detail-icon">🏢</span>
                      <span className="detail-text">{platforms[selectedPlatform].company}</span>
                    </div>
                  )}
                </div>
              )}

              {((platforms[selectedPlatform].followers_count !== null && platforms[selectedPlatform].followers_count !== undefined) ||
                (platforms[selectedPlatform].following_count !== null && platforms[selectedPlatform].following_count !== undefined)) && (
                  <div className="platform-followers">
                    <svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" className="followers-icon">
                      <path d="M2 5.5a3.5 3.5 0 1 1 5.898 2.549 5.508 5.508 0 0 1 3.034 4.084.75.75 0 1 1-1.482.235 4 4 0 0 0-7.9 0 .75.75 0 0 1-1.482-.236A5.507 5.507 0 0 1 3.102 8.05 3.493 3.493 0 0 1 2 5.5ZM11 4a3.001 3.001 0 0 1 2.22 5.018 5.01 5.01 0 0 1 2.56 3.012.749.749 0 0 1-.885.954.752.752 0 0 1-.549-.514 3.507 3.507 0 0 0-2.522-2.372.75.75 0 0 1-.574-.73v-.352a.75.75 0 0 1 .416-.672A1.5 1.5 0 0 0 11 5.5.75.75 0 0 1 11 4Zm-5.5-.5a2 2 0 1 0-.001 3.999A2 2 0 0 0 5.5 3.5Z" fill="currentColor"></path>
                    </svg>
                    {(platforms[selectedPlatform].followers_count !== null && platforms[selectedPlatform].followers_count !== undefined) && (
                      <>
                        <span className="follower-count">{platforms[selectedPlatform].followers_count}</span>
                        <span className="follower-label">followers</span>
                      </>
                    )}
                    {(platforms[selectedPlatform].followers_count !== null && platforms[selectedPlatform].followers_count !== undefined) &&
                      (platforms[selectedPlatform].following_count !== null && platforms[selectedPlatform].following_count !== undefined) && (
                        <span className="follower-separator">·</span>
                      )}
                    {(platforms[selectedPlatform].following_count !== null && platforms[selectedPlatform].following_count !== undefined) && (
                      <>
                        <span className="follower-count">{platforms[selectedPlatform].following_count}</span>
                        <span className="follower-label">following</span>
                      </>
                    )}
                  </div>
                )}

              {platforms[selectedPlatform].profile_url && (
                <a
                  href={platforms[selectedPlatform].profile_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="platform-profile-link"
                >
                  View Profile →
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Empty State - Only show for authenticated users with no platforms */}
      {!isPublic && (!platforms || platforms.length === 0) && (
        <div className="empty-state">
          <p className="empty-message">No platforms connected yet</p>
          <p className="empty-hint">Connect a platform to see your profile</p>
        </div>
      )}
    </div>
  );
};

export default UserProfile;

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../api/client';
import ActivityIcons from './ActivityIcons';
import './ActivityTimeline.css';

// Parse 'YYYY-MM-DD' as a local date (new Date(str) would be UTC and shift a day)
const parseLocalDate = (dateStr) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr || '');
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(dateStr);
};

function ActivityTimeline({ platformFilter = 'all', username = null, isPublic = false }) {
  const { user } = useAuth();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [platforms, setPlatforms] = useState([]);
  const limit = 20;

  const loadActivities = useCallback(async (newOffset = 0) => {
    try {
      setLoading(true);
      setError(null);


      // Pass platform filter to API (null if 'all')
      const platform = platformFilter !== 'all' ? platformFilter : null;

      // Use public or authenticated API based on isPublic flag
      const data = isPublic
        ? await apiClient.getUserActivities(username, null, null, limit, newOffset, platform)
        : await apiClient.getActivities(null, null, limit, newOffset, platform);


      if (newOffset === 0) {
        // Initial load
        setActivities(data.activities || []);
        setInitialLoadComplete(true);
      } else {
        // Load more
        setActivities(prev => [...prev, ...(data.activities || [])]);
      }

      setHasMore(data.has_more);
      setOffset(newOffset);

    } catch (err) {
      console.error('❌ [ActivityTimeline] Failed to load activities:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, platformFilter, isPublic, username]);

  useEffect(() => {

    // Reset state when platform filter changes
    setInitialLoadComplete(false);
    setActivities([]);
    setOffset(0);

    loadActivities(0);

    // Fetch platforms to get platform usernames
    const fetchPlatforms = async () => {
      try {
        const platformsData = isPublic
          ? await apiClient.getUserPlatforms(username)
          : await apiClient.getPlatforms();
        setPlatforms(platformsData);
      } catch (err) {
        console.error('❌ [ActivityTimeline] Failed to fetch platforms:', err);
      }
    };

    fetchPlatforms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadActivities, isPublic, username]);

  const loadMore = () => {
    if (hasMore && !loading) {
      loadActivities(offset + limit);
    }
  };

  const formatDate = (dateStr) => {
    const date = parseLocalDate(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.max(0, Math.round((today - date) / (1000 * 60 * 60 * 24)));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getDate()}`;
  };

  const groupActivitiesByMonth = () => {
    const groups = {};

    // Track processed activity IDs to avoid double-counting
    const processedActivityIds = new Set();


    activities.forEach((activity, index) => {
      // Skip if we've already processed this activity
      if (processedActivityIds.has(activity.id)) {
        return;
      }
      processedActivityIds.add(activity.id);

      const date = parseLocalDate(activity.date);
      const monthYear = `${date.toLocaleString('default', { month: 'long' })} ${date.getFullYear()}`;

      if (!groups[monthYear]) {
        groups[monthYear] = [];
      }

      if (activity.activity_type === 'PrivateContribution') {
        // Pages can split a month's private contributions; merge them per month
        const existing = groups[monthYear].find(a => a.activity_type === 'PrivateContribution');
        if (existing) {
          existing.count += activity.count;
          return;
        }
        groups[monthYear].push({ ...activity });
        return;
      }

      groups[monthYear].push(activity);

      if (index < 3) {
      }
    });

    return groups;
  };

  const generateAllMonths = (groupedActivities) => {

    // Only generate months for activities we've actually loaded
    // Don't show empty months for data we haven't fetched yet
    if (activities.length === 0) {
      return [];
    }

    // Find actual date range from loaded activities
    const activityDates = activities.map(a => parseLocalDate(a.date));
    const minDate = new Date(Math.min(...activityDates));
    const maxDate = new Date(Math.max(...activityDates));

    const startDate = new Date(minDate);
    startDate.setDate(1); // First day of the month

    const endDate = new Date(maxDate);


    const allMonths = [];
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const monthYear = `${currentDate.toLocaleString('default', { month: 'long' })} ${currentDate.getFullYear()}`;

      allMonths.push({
        key: monthYear,
        activities: groupedActivities[monthYear] || [],
        isEmpty: !groupedActivities[monthYear] || groupedActivities[monthYear].length === 0
      });

      currentDate.setMonth(currentDate.getMonth() + 1);
    }


    // Reverse to show most recent first
    return allMonths.reverse();
  };

  const getActivityIcon = (type) => {
    const IconComponent = ActivityIcons[type] || ActivityIcons.Default;
    return <IconComponent />;
  };

  const getCommitBarColor = (commitCount, maxCommits) => {
    // Calculate intensity similar to heatmap (0-4 levels)
    const percentage = commitCount / maxCommits;

    // Check if dark theme is active
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    // Use GitHub's contribution colors (light theme)
    if (!isDark) {
      if (percentage >= 0.75) return '#2da44e'; // level-3
      if (percentage >= 0.50) return '#4ac26b'; // level-2
      if (percentage >= 0.25) return '#aceebb'; // level-1
      return '#9be9a8'; // light green for smallest
    }

    // Dark theme colors
    if (percentage >= 0.75) return '#2ea043'; // level-3
    if (percentage >= 0.50) return '#196c2e'; // level-2
    if (percentage >= 0.25) return '#033a16'; // level-1
    return '#0d4429'; // darker green for smallest
  };

  const formatActivityType = (type) => {
    // Convert from PascalCase to space-separated
    return type.replace(/([A-Z])/g, ' $1').trim();
  };

  const getRepositoryUrl = (activity, repoName) => {
    // If repository_url is already set, use it
    if (activity.repository_url) {
      return activity.repository_url;
    }

    // Otherwise construct URL based on platform
    const platform = activity.platform?.toLowerCase();
    const platformUrl = activity.platform_url;

    if (platform === 'github') {
      return `https://github.com/${repoName}`;
    } else if (platform === 'gitea' && platformUrl) {
      return `${platformUrl}/${repoName}`;
    } else if (platform === 'gitlab') {
      if (platformUrl) {
        return `${platformUrl}/${repoName}`;
      }
      return `https://gitlab.com/${repoName}`;
    }

    // Fallback
    return `https://github.com/${repoName}`;
  };

  const renderActivity = (activity) => {
    const metadata = activity.metadata || {};

    switch (activity.activity_type) {
      case 'Commit': {
        const repos = metadata.repositories || [];
        const totalCommits = activity.count;
        const maxCommits = Math.max(1, ...repos.map(r => r.commit_count));

        return (
          <div className="activity-item" key={activity.id}>
            <div className="activity-icon">{getActivityIcon(activity.activity_type)}</div>
            <div className="activity-content">
              <div className="activity-header">
                Created {totalCommits} commit{totalCommits !== 1 ? 's' : ''} in {repos.length} {repos.length === 1 ? 'repository' : 'repositories'}
              </div>
              <div className="activity-details">
                {repos.map((repo, idx) => (
                  <div key={idx} className="repository-item">
                    <a href={getRepositoryUrl(activity, repo.name)} target="_blank" rel="noopener noreferrer">
                      {repo.name}
                    </a>
                    <span className="commit-count">{repo.commit_count} commits</span>
                    <div className="commit-bar">
                      <div
                        className="commit-fill"
                        style={{
                          width: `${(repo.commit_count / totalCommits) * 100}%`,
                          backgroundColor: getCommitBarColor(repo.commit_count, maxCommits)
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="activity-date">{formatDate(activity.date)}</div>
            </div>
          </div>
        );
      }

      case 'RepositoryCreated':
        return (
          <div className="activity-item" key={activity.id}>
            <div className="activity-icon">{getActivityIcon(activity.activity_type)}</div>
            <div className="activity-content">
              <div className="activity-header">Created 1 repository</div>
              <div className="activity-details">
                <div className="repository-item">
                  <a href={getRepositoryUrl(activity, activity.repository_name)} target="_blank" rel="noopener noreferrer">
                    {activity.repository_name}
                  </a>
                  {activity.primary_language && (
                    <span className="language-tag" data-language={activity.primary_language}>
                      {activity.primary_language}
                    </span>
                  )}
                </div>
              </div>
              <div className="activity-date">{formatDate(activity.date)}</div>
            </div>
          </div>
        );

      case 'OrganizationJoined':
        return (
          <div className="activity-item" key={activity.id}>
            <div className="activity-icon">{getActivityIcon(activity.activity_type)}</div>
            <div className="activity-content">
              <div className="activity-header">Joined the {activity.organization_name} organization</div>
              <div className="activity-date">{formatDate(activity.date)}</div>
            </div>
          </div>
        );

      case 'PullRequest':
      case 'Issue':
        return (
          <div className="activity-item" key={activity.id}>
            <div className="activity-icon">{getActivityIcon(activity.activity_type)}</div>
            <div className="activity-content">
              <div className="activity-header-row">
                <div className="activity-header">
                  {activity.activity_type === 'PullRequest' ? 'Created a pull request in' : 'Created an issue in'}{' '}
                  <a href={getRepositoryUrl(activity, activity.repository_name)} target="_blank" rel="noopener noreferrer">
                    {activity.repository_name}
                  </a>
                  {metadata.comment_count !== undefined && metadata.comment_count > 0 && (
                    <span> that received {metadata.comment_count} comment{metadata.comment_count !== 1 ? 's' : ''}</span>
                  )}
                </div>
                <div className="activity-date">{formatDate(activity.date)}</div>
              </div>
              {metadata.title && (
                <div className="activity-details">
                  <div className="issue-card">
                    <svg className="issue-icon" title="Closed" aria-hidden="true" height="16" viewBox="0 0 16 16" width="16" fill="currentColor">
                      <path d="M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5Z"></path>
                      <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0Z"></path>
                    </svg>
                    <div className="issue-content">
                      <h3 className="issue-title">
                        <a href={metadata.url} target="_blank" rel="noopener noreferrer">
                          {metadata.title}
                        </a>
                      </h3>
                      {metadata.body && metadata.body.trim() && (
                        <div className="issue-body">
                          <p>{metadata.body.length > 200 ? metadata.body.substring(0, 200) + '…' : metadata.body}</p>
                        </div>
                      )}
                      {metadata.comment_count !== undefined && (
                        <div className="issue-footer">
                          {metadata.comment_count} comment{metadata.comment_count !== 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        );

      case 'PrivateContribution': {
        const n = activity.count || 1;
        return (
          <div className="activity-item" key={activity.id}>
            <div className="activity-icon">{getActivityIcon(activity.activity_type)}</div>
            <div className="activity-content">
              <div className="activity-header">
                Made {n} private contribution{n !== 1 ? 's' : ''}
              </div>
            </div>
          </div>
        );
      }

      case 'Review':
      case 'Fork':
      case 'Release':
      case 'Star': {
        const verbs = {
          Review: 'Reviewed a pull request in',
          Fork: 'Forked',
          Release: 'Released',
          Star: 'Starred',
        };
        return (
          <div className="activity-item" key={activity.id}>
            <div className="activity-icon">{getActivityIcon(activity.activity_type)}</div>
            <div className="activity-content">
              <div className="activity-header-row">
                <div className="activity-header">
                  {verbs[activity.activity_type]}{' '}
                  {activity.repository_name ? (
                    <a href={getRepositoryUrl(activity, activity.repository_name)} target="_blank" rel="noopener noreferrer">
                      {activity.repository_name}
                    </a>
                  ) : (
                    <span>a repository</span>
                  )}
                </div>
                <div className="activity-date">{formatDate(activity.date)}</div>
              </div>
            </div>
          </div>
        );
      }

      default:
        return (
          <div className="activity-item" key={activity.id}>
            <div className="activity-icon">{getActivityIcon(activity.activity_type)}</div>
            <div className="activity-content">
              <div className="activity-header">{formatActivityType(activity.activity_type)}</div>
              {activity.repository_name && (
                <div className="activity-details">
                  <a href={getRepositoryUrl(activity, activity.repository_name)} target="_blank" rel="noopener noreferrer">
                    {activity.repository_name}
                  </a>
                </div>
              )}
              <div className="activity-date">{formatDate(activity.date)}</div>
            </div>
          </div>
        );
    }
  };


  if (error) {
    return (
      <div className="activity-timeline">
        <div className="error-message">Failed to load activities: {error}</div>
      </div>
    );
  }

  // Show loading state during initial load - don't render months until we have data
  if (!initialLoadComplete) {
    return (
      <div className="activity-timeline">
        <div className="timeline-header">
          <h2 className="timeline-title">Contribution activity</h2>
        </div>
        <div className="loading-message">Loading activities...</div>
      </div>
    );
  }

  const groupedActivities = groupActivitiesByMonth();

  const allMonths = generateAllMonths(groupedActivities);

  // Get platform username (prefer first platform's username)
  const selectedAccount = platformFilter !== 'all' ? platforms.find(p => p.id === platformFilter) : null;
  const platformUsername = selectedAccount ? selectedAccount.platform_username : platforms.length > 0 ? platforms[0].platform_username : (user?.username || 'User');


  return (
    <div className="activity-timeline">
      <div className="timeline-header">
        <h2 className="timeline-title">Contribution activity</h2>
      </div>

      <div className="timeline-content">
        {activities.length === 0 && (
          <div className="empty-month-message">
            <span>No activity to show</span>
          </div>
        )}
        {allMonths.map((month) => (
          <div key={month.key} className="month-group">
            <h3 className="month-header">{month.key}</h3>
            {month.isEmpty ? (
              <div className="empty-month-message">
                <span>{platformUsername} had no activity during this period.</span>
              </div>
            ) : (
              <div className="activities-list">
                {month.activities.map(activity => renderActivity(activity))}
              </div>
            )}
          </div>
        ))}

        {hasMore && (
          <div className="load-more-container">
            <button
              className="load-more-button"
              onClick={loadMore}
              disabled={loading}
            >
              {loading ? 'Loading...' : 'Show more activity'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default ActivityTimeline;

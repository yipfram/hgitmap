import { useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '../api/client';
import './Heatmap.css';

const formatLocalDate = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// Parse 'YYYY-MM-DD' as a local date (new Date(str) would parse it as UTC)
const parseLocalDate = (str) => {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const PLATFORM_NAMES = { github: 'GitHub', gitlab: 'GitLab', gitea: 'Gitea' };

function getAccountLabel(account) {
  const name = PLATFORM_NAMES[account.platform] || account.platform;
  let detail = account.platform_username;
  if (account.platform_url) {
    try {
      detail = new URL(account.platform_url).hostname;
    } catch {
      detail = account.platform_url;
    }
  }
  return detail ? `${name} (${detail})` : name;
}

function Heatmap({ platformFilter = 'all', setPlatformFilter, username = null, isPublic = false }) {
  const [contributions, setContributions] = useState([]);
  const [_stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState('rolling'); // 'rolling' or 'year'
  const [year, setYear] = useState(new Date().getFullYear());
  const [platforms, setPlatforms] = useState([]);
  const [activeDate, setActiveDate] = useState(null); // roving tab stop
  const [tooltip, setTooltip] = useState(null); // { text, x, y }
  const wrapperRef = useRef(null);
  const gridRef = useRef(null);

  // Load available platform accounts (own or public)
  useEffect(() => {
    const loadPlatforms = async () => {
      try {
        const platformList = isPublic
          ? await apiClient.getUserPlatforms(username)
          : await apiClient.listPlatforms();
        setPlatforms(platformList);
      } catch (err) {
        console.error('Failed to load platforms:', err);
      }
    };
    loadPlatforms();
  }, [isPublic, username]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      let fromDate, toDate;

      if (viewMode === 'rolling') {
        // Rolling 365 days: match GitHub's behavior
        // GitHub completes the first week by starting from the Sunday before
        const today = new Date();

        // Calculate 365-day window start (364 days back + today = 365 days)
        const windowStart = new Date(today);
        windowStart.setDate(windowStart.getDate() - 364);

        // Find the Sunday before (or on) the window start
        const dayOfWeek = windowStart.getDay(); // 0 = Sunday, 6 = Saturday
        const from = new Date(windowStart);
        if (dayOfWeek !== 0) {
          from.setDate(from.getDate() - dayOfWeek); // Go back to Sunday
        }

        fromDate = formatLocalDate(from);
        toDate = formatLocalDate(today);

      } else {
        // Calendar year mode: Jan 1 to Dec 31 of selected year
        fromDate = `${year}-01-01`;
        toDate = `${year}-12-31`;

      }

      // platformFilter is a platform account id ('all' = every account)
      const accountFilter = platformFilter !== 'all' ? platformFilter : null;

      // Use public or authenticated API based on isPublic flag
      const [contributionsData, statsData] = await Promise.all([
        isPublic
          ? apiClient.getUserContributions(username, fromDate, toDate, accountFilter)
          : apiClient.getContributions(fromDate, toDate, accountFilter),
        isPublic
          ? apiClient.getUserStats(username, accountFilter)
          : apiClient.getContributionStats(accountFilter),
      ]);


      setContributions(contributionsData.contributions || []);
      setStats(statsData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [viewMode, year, platformFilter, username, isPublic]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Show the most recent weeks first (matters on narrow screens)
  useEffect(() => {
    if (!loading && wrapperRef.current) {
      wrapperRef.current.scrollLeft = wrapperRef.current.scrollWidth;
    }
  }, [loading, viewMode, year, contributions]);

  const getWeeksInYear = () => {
    const weeks = [];
    let startDate, endDate, windowStart;

    if (viewMode === 'rolling') {
      // Rolling 365 days (364 days back + today)
      const today = new Date();
      today.setHours(23, 59, 59, 999);

      windowStart = new Date(today);
      windowStart.setDate(windowStart.getDate() - 364);
      windowStart.setHours(0, 0, 0, 0);

      // The grid starts on the Sunday before the window; days before the
      // window start are rendered as empty cells.
      startDate = new Date(windowStart);
      endDate = today;
    } else {
      startDate = new Date(year, 0, 1);
      windowStart = startDate;

      const today = new Date();
      today.setHours(23, 59, 59, 999);

      endDate = new Date(year, 11, 31);
      endDate.setHours(23, 59, 59, 999);
      if (year === today.getFullYear()) {
        endDate = today;
      }
    }

    const countsByDate = new Map(contributions.map((c) => [c.date, c.count]));

    const currentDate = new Date(startDate);
    currentDate.setDate(currentDate.getDate() - startDate.getDay()); // back to Sunday

    while (currentDate <= endDate) {
      const week = [];
      for (let i = 0; i < 7; i++) {
        const date = new Date(currentDate);
        date.setDate(date.getDate() + i);
        date.setHours(0, 0, 0, 0);

        const dateStr = formatLocalDate(date);
        const shouldInclude =
          date >= windowStart && date <= endDate && (viewMode === 'rolling' || date.getFullYear() === year);

        if (shouldInclude) {
          week.push({
            date: dateStr,
            count: countsByDate.get(dateStr) || 0,
            month: date.getMonth(),
            day: date.getDay(),
          });
        } else {
          week.push(null); // Empty cell outside the displayed range
        }
      }
      weeks.push(week);
      currentDate.setDate(currentDate.getDate() + 7);
    }

    return weeks;
  };

  const calculateQuartiles = (contributions) => {
    // GitHub: Calculate quartiles from the range [0, max]
    // "quartiles of the normal distribution over the range [0, max(v)]"
    const nonZeroCounts = contributions
      .map(c => c.count)
      .filter(count => count > 0);

    if (nonZeroCounts.length === 0) {
      return { q1: 0, q2: 0, q3: 0, max: 0 };
    }

    const max = Math.max(...nonZeroCounts);

    // Divide the max into quartiles (not percentiles of the data)
    const q1 = max * 0.25;
    const q2 = max * 0.50;
    const q3 = max * 0.75;


    return { q1, q2, q3, max };
  };

  const getIntensityLevel = (count, quartiles) => {
    if (count === 0) return 0;

    // GitHub's quartile-based algorithm:
    // Level 1: up to Q1 (inclusive)
    // Level 2: above Q1, up to Q2 (inclusive)
    // Level 3: above Q2, up to Q3 (inclusive)
    // Level 4: above Q3
    if (count <= quartiles.q1) return 1;
    if (count <= quartiles.q2) return 2;
    if (count <= quartiles.q3) return 3;
    return 4;
  };

  const getOrdinalSuffix = (day) => {
    if (day > 3 && day < 21) return 'th';
    switch (day % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  };

  const formatTooltipDate = (date) => {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const month = monthNames[date.getMonth()];
    const day = date.getDate();
    const suffix = getOrdinalSuffix(day);
    return `${month} ${day}${suffix}`;
  };

  const formatAriaDate = (date) =>
    date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const showTooltip = (el, text) => {
    const rect = el.getBoundingClientRect();
    setTooltip({ text, x: rect.left + rect.width / 2, y: rect.top });
  };

  // Arrow-key navigation between cells (roving tabindex)
  const handleCellKeyDown = (e, weekIndex, dayIndex) => {
    if (e.key === 'Escape') {
      setTooltip(null);
      return;
    }
    const delta = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    }[e.key];
    if (!delta) return;
    e.preventDefault();
    const target = gridRef.current?.querySelector(
      `[data-w="${weekIndex + delta[0]}"][data-d="${dayIndex + delta[1]}"]:not(.empty)`
    );
    if (target) target.focus();
  };

  const getMonthLabels = (weeks) => {
    const monthLabels = [];
    let lastMonth = -1;

    weeks.forEach((week, weekIndex) => {
      // Find the first valid day in the week to determine the month
      const firstValidDay = week.find(day => day !== null);

      if (firstValidDay && firstValidDay.month !== lastMonth) {
        monthLabels.push({
          month: firstValidDay.month,
          weekIndex: weekIndex,
        });
        lastMonth = firstValidDay.month;
      }
    });

    return monthLabels;
  };

  if (loading) {
    return (
      <div className="heatmap-container">
        <div className="heatmap-loading">Loading contributions...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="heatmap-container">
        <div className="heatmap-error">Error loading contributions: {error}</div>
      </div>
    );
  }

  const weeks = getWeeksInYear();
  const monthLabels = getMonthLabels(weeks);
  // Only days actually displayed count (excludes days before the 365-day window)
  const visibleDays = weeks.flat().filter(Boolean);
  const totalContributions = visibleDays.reduce((sum, c) => sum + c.count, 0);
  const tabStopDate = activeDate && visibleDays.some((d) => d.date === activeDate)
    ? activeDate
    : visibleDays[visibleDays.length - 1]?.date;

  // Calculate quartiles for dynamic color intensity (GitHub-style)
  const quartiles = calculateQuartiles(visibleDays);

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return (
    <div className="heatmap-container" data-platform={platformFilter}>
      <div className="heatmap-layout">
        <div className="heatmap-main">
          {/* Header */}
          <div className="heatmap-header">
            <h2>
              {totalContributions.toLocaleString()} contributions{' '}
              {viewMode === 'rolling' ? 'in the last year' : `in ${year}`}
            </h2>
          </div>

          {/* Heatmap Grid */}
          <div className="heatmap-wrapper" ref={wrapperRef}>
            <div className="heatmap-months">
              {monthLabels.map((label, index) => (
                <div
                  key={index}
                  className="month-label"
                  style={{ gridColumn: label.weekIndex + 1 }}
                >
                  {monthNames[label.month]}
                </div>
              ))}
            </div>

            <div className="heatmap-grid-wrapper">
              <div className="heatmap-days">
                <div className="day-label"></div>
                <div className="day-label">Mon</div>
                <div className="day-label"></div>
                <div className="day-label">Wed</div>
                <div className="day-label"></div>
                <div className="day-label">Fri</div>
                <div className="day-label"></div>
              </div>

              <div
                className="heatmap-grid"
                ref={gridRef}
                role="group"
                aria-label={`Contribution calendar: ${totalContributions.toLocaleString()} contributions ${viewMode === 'rolling' ? 'in the last year' : `in ${year}`}. Use arrow keys to move between days.`}
              >
                {weeks.map((week, weekIndex) => (
                  <div key={weekIndex} className="heatmap-week">
                    {week.map((day, dayIndex) => {
                      if (!day) {
                        return <div key={dayIndex} className="heatmap-day empty" aria-hidden="true"></div>;
                      }

                      const level = getIntensityLevel(day.count, quartiles);
                      const date = parseLocalDate(day.date);
                      const tooltipDate = formatTooltipDate(date);
                      const tooltipText = day.count === 0
                        ? `No contributions on ${tooltipDate}.`
                        : `${day.count} contribution${day.count === 1 ? '' : 's'} on ${tooltipDate}.`;
                      const ariaLabel = `${day.count === 0 ? 'No' : day.count} contribution${day.count === 1 ? '' : 's'} on ${formatAriaDate(date)}`;

                      return (
                        <div
                          key={dayIndex}
                          className={`heatmap-day level-${level}`}
                          data-count={day.count}
                          data-date={tooltipDate}
                          data-w={weekIndex}
                          data-d={dayIndex}
                          role="img"
                          aria-label={ariaLabel}
                          tabIndex={day.date === tabStopDate ? 0 : -1}
                          onMouseEnter={(e) => showTooltip(e.currentTarget, tooltipText)}
                          onMouseLeave={() => setTooltip(null)}
                          onFocus={(e) => {
                            setActiveDate(day.date);
                            showTooltip(e.currentTarget, tooltipText);
                          }}
                          onBlur={() => setTooltip(null)}
                          onClick={(e) => showTooltip(e.currentTarget, tooltipText)}
                          onKeyDown={(e) => handleCellKeyDown(e, weekIndex, dayIndex)}
                        ></div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* Legend */}
            <div className="heatmap-legend">
              <span className="legend-label">Less</span>
              <div className="legend-square level-0"></div>
              <div className="legend-square level-1"></div>
              <div className="legend-square level-2"></div>
              <div className="legend-square level-3"></div>
              <div className="legend-square level-4"></div>
              <span className="legend-label">More</span>
            </div>
          </div>

          {tooltip && (
            <div
              className="heatmap-tooltip"
              role="tooltip"
              style={{ left: tooltip.x, top: tooltip.y }}
            >
              {tooltip.text}
            </div>
          )}

          {contributions.length === 0 && (
            <div className="no-contributions-message">
              <p>No contributions yet {viewMode === 'rolling' ? 'in the last year' : `for ${year}`}.</p>
              <p>Connect a platform to start tracking your contributions!</p>
            </div>
          )}
        </div>

        {/* Year Selector Sidebar */}
        <div className="year-selector-sidebar">
          {/* Platform Filter */}
          <div className="platform-filter-section">
            <label htmlFor="platform-filter" className="platform-filter-label">
              Filter by Platform:
            </label>
            <select
              id="platform-filter"
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              className="platform-filter-select"
            >
              <option value="all">All Platforms</option>
              {platforms.map((platform) => (
                <option key={platform.id} value={platform.id}>
                  {getAccountLabel(platform)}
                </option>
              ))}
            </select>
          </div>

          <div className="year-filter-divider"></div>

          <button
            className={`year-item ${viewMode === 'rolling' ? 'active' : ''}`}
            aria-pressed={viewMode === 'rolling'}
            onClick={() => {
              setViewMode('rolling');
              setYear(new Date().getFullYear());
            }}
          >
            Last year
          </button>
          {Array.from({ length: new Date().getFullYear() - 2019 }, (_, i) => {
            const y = new Date().getFullYear() - i;
            return (
              <button
                key={y}
                className={`year-item ${viewMode === 'year' && year === y ? 'active' : ''}`}
                aria-pressed={viewMode === 'year' && year === y}
                onClick={() => {
                  setViewMode('year');
                  setYear(y);
                }}
              >
                {y}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default Heatmap;

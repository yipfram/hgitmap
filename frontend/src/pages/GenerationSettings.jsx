import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';
import { useToast } from '../context/ToastContext';
import './GenerationSettings.css';

const MIN_DATE_RANGE = 30;
const MAX_DATE_RANGE = 730;
const POLL_INTERVAL_MS = 5000;

const INTERVAL_OPTIONS = [
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '60 minutes (1 hour)' },
  { value: 180, label: '180 minutes (3 hours)' },
  { value: 360, label: '360 minutes (6 hours)' },
  { value: 720, label: '720 minutes (12 hours)' },
  { value: 1440, label: '1440 minutes (24 hours)' },
];

const isActiveJob = (job) => job.status === 'pending' || job.status === 'processing';

function GenerationSettings() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [dateRangeError, setDateRangeError] = useState(null);
  const [jobs, setJobs] = useState([]);

  const [settings, setSettings] = useState({
    update_interval_minutes: 60,
    auto_generation_enabled: true,
    include_private_contributions: true,
  });
  // Kept as a string so that an empty field can be detected and reported
  const [dateRange, setDateRange] = useState('365');

  const loadJobs = useCallback(async () => {
    try {
      const data = await apiClient.listGenerationJobs(null, 20);
      setJobs(data);
    } catch (err) {
      console.error('Failed to load jobs:', err);
    }
  }, []);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        setLoading(true);
        const data = await apiClient.getGenerationSettings();
        setSettings({
          update_interval_minutes: data.update_interval_minutes,
          auto_generation_enabled: data.auto_generation_enabled,
          include_private_contributions: data.include_private_contributions,
        });
        setDateRange(String(data.date_range_days));
        setLoadError(null);
      } catch (err) {
        setLoadError(err.message);
      } finally {
        setLoading(false);
      }
    };
    loadSettings();
    loadJobs();
  }, [loadJobs]);

  // Poll while any job is pending/processing
  const hasActiveJob = jobs.some(isActiveJob);
  useEffect(() => {
    if (!hasActiveJob) return undefined;
    const timer = setInterval(loadJobs, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasActiveJob, loadJobs]);

  const handleChange = (field, value) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
    setSaveError(null);
  };

  const validateDateRange = (raw) => {
    const trimmed = String(raw).trim();
    if (trimmed === '') return 'Date range is required.';
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < MIN_DATE_RANGE || n > MAX_DATE_RANGE) {
      return `Date range must be a whole number between ${MIN_DATE_RANGE} and ${MAX_DATE_RANGE} days.`;
    }
    return null;
  };

  const handleDateRangeChange = (value) => {
    setDateRange(value);
    setDateRangeError(null);
    setSaveError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const rangeError = validateDateRange(dateRange);
    if (rangeError) {
      setDateRangeError(rangeError);
      setSaveError('Please fix the highlighted field before saving.');
      return;
    }

    try {
      setSaving(true);
      setSaveError(null);
      await apiClient.updateGenerationSettings({
        ...settings,
        date_range_days: Number(dateRange),
      });
      toast.success('Generation settings saved');
    } catch (err) {
      setSaveError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTriggerGeneration = async () => {
    try {
      await apiClient.triggerGeneration();
      toast.success('Heatmap generation started');
      await loadJobs();
    } catch (err) {
      toast.error(`Failed to trigger generation: ${err.message}`);
    }
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'completed':
        return 'status-completed';
      case 'processing':
        return 'status-processing';
      case 'failed':
        return 'status-failed';
      default:
        return 'status-pending';
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString();
  };

  const intervalOptions = INTERVAL_OPTIONS.some((o) => o.value === settings.update_interval_minutes)
    ? INTERVAL_OPTIONS
    : [
        ...INTERVAL_OPTIONS,
        { value: settings.update_interval_minutes, label: `${settings.update_interval_minutes} minutes` },
      ].sort((a, b) => a.value - b.value);

  if (loading) {
    return (
      <div className="gen-container">
        <div className="gen-loading">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="gen-container">
      <div className="gen-header">
        <h1>Generation</h1>
        <p className="gen-subtitle">
          Control how and when your heatmap images are generated
        </p>
      </div>

      {loadError && <div className="gen-error" role="alert">{loadError}</div>}

      <div className="gen-content">
        <form onSubmit={handleSubmit} className="gen-card" noValidate>
          <section className="gen-section">
            <h2>Automatic Generation</h2>

            <div className="gen-row">
              <div className="gen-row-info">
                <label className="gen-label" htmlFor="gen-auto">
                  Enable automatic heatmap generation
                </label>
                <p className="gen-hint">
                  When enabled, heatmaps are regenerated automatically based on the update interval below.
                </p>
              </div>
              <label className="toggle-switch">
                <input
                  id="gen-auto"
                  type="checkbox"
                  checked={settings.auto_generation_enabled}
                  onChange={(e) => handleChange('auto_generation_enabled', e.target.checked)}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>

            {settings.auto_generation_enabled && (
              <div className="gen-field">
                <label className="gen-label" htmlFor="gen-interval">Update interval</label>
                <select
                  id="gen-interval"
                  value={settings.update_interval_minutes}
                  onChange={(e) => handleChange('update_interval_minutes', parseInt(e.target.value, 10))}
                >
                  {intervalOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <p className="gen-hint">How often to regenerate heatmaps automatically.</p>
              </div>
            )}
          </section>

          <section className="gen-section">
            <h2>Data</h2>

            <div className="gen-field">
              <label className="gen-label" htmlFor="gen-range">Date range (days)</label>
              <input
                id="gen-range"
                type="number"
                inputMode="numeric"
                min={MIN_DATE_RANGE}
                max={MAX_DATE_RANGE}
                value={dateRange}
                aria-invalid={dateRangeError ? 'true' : undefined}
                aria-describedby={dateRangeError ? 'gen-range-error' : undefined}
                className={dateRangeError ? 'gen-input-invalid' : undefined}
                onChange={(e) => handleDateRangeChange(e.target.value)}
              />
              {dateRangeError && (
                <p className="gen-field-error" id="gen-range-error" role="alert">{dateRangeError}</p>
              )}
              <p className="gen-hint">
                How many days of contribution data to include ({MIN_DATE_RANGE}-{MAX_DATE_RANGE} days).
                Common values: 90 (3 months), 180 (6 months), 365 (1 year).
              </p>
            </div>

            <div className="gen-row">
              <div className="gen-row-info">
                <label className="gen-label" htmlFor="gen-private">
                  Include private contributions in generated heatmaps
                </label>
                <p className="gen-hint">
                  Only affects generated heatmap images. It has no effect unless{' '}
                  <Link to="/settings">Show Private Contributions</Link> is enabled in Preferences,
                  which is the global setting.
                </p>
              </div>
              <label className="toggle-switch">
                <input
                  id="gen-private"
                  type="checkbox"
                  checked={settings.include_private_contributions}
                  onChange={(e) => handleChange('include_private_contributions', e.target.checked)}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>
          </section>

          <div className="gen-actions">
            {saveError && <div className="gen-error gen-error-inline" role="alert">{saveError}</div>}
            <button type="submit" className="gen-btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>

        <section className="gen-card gen-manual">
          <h2>Manual Generation</h2>
          <p>Trigger immediate regeneration of all heatmaps, regardless of the automatic schedule.</p>
          <button type="button" className="gen-btn-primary" onClick={handleTriggerGeneration}>
            Generate All Heatmaps Now
          </button>
        </section>

        <section className="gen-card">
          <h2>Recent Generation Jobs</h2>
          {jobs.length === 0 ? (
            <p className="gen-empty">No generation jobs yet.</p>
          ) : (
            <div className="gen-jobs">
              <table>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Theme</th>
                    <th>Scheduled</th>
                    <th>Started</th>
                    <th>Completed</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id}>
                      <td data-label="Status">
                        <span className={`status-badge ${getStatusBadgeClass(job.status)}`}>
                          {job.status}
                        </span>
                      </td>
                      <td data-label="Theme">
                        {job.theme_name || (job.theme_id ? 'Unknown theme' : 'All themes')}
                      </td>
                      <td data-label="Scheduled">{formatDate(job.scheduled_at)}</td>
                      <td data-label="Started">{formatDate(job.started_at)}</td>
                      <td data-label="Completed">{formatDate(job.completed_at)}</td>
                      <td data-label="Type">
                        <span className={job.is_manual ? 'badge-manual' : 'badge-auto'}>
                          {job.is_manual ? 'Manual' : 'Auto'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default GenerationSettings;

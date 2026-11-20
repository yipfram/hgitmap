import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import apiClient from '../api/client';
import './SyncSettings.css';

const MIN_DATE_RANGE = 30;
const MAX_DATE_RANGE = 730;

const INTERVAL_OPTIONS = [
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
  { value: 120, label: 'Every 2 hours' },
  { value: 180, label: 'Every 3 hours' },
  { value: 360, label: 'Every 6 hours' },
  { value: 720, label: 'Every 12 hours' },
  { value: 1440, label: 'Once a day' },
];

const prefsOf = (p) => ({ sync_profile: !!p.sync_profile, sync_contributions: !!p.sync_contributions });

function SyncSettings() {
  const { user } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [dateRangeError, setDateRangeError] = useState(null);

  const [settings, setSettings] = useState({
    auto_generation_enabled: false,
    update_interval_minutes: 60,
    include_private_contributions: true,
  });
  const [dateRange, setDateRange] = useState('365');
  const [savedSnapshot, setSavedSnapshot] = useState(null);

  const [syncStatus, setSyncStatus] = useState(null);
  const [platforms, setPlatforms] = useState([]);
  const [savedPlatforms, setSavedPlatforms] = useState({});

  const loadPlatforms = useCallback(async () => {
    try {
      const platformData = await apiClient.listPlatforms();
      setPlatforms(platformData);
      setSavedPlatforms(
        Object.fromEntries(platformData.map((p) => [p.id, prefsOf(p)]))
      );
    } catch (err) {
      console.error('Failed to load platforms:', err);
    }
  }, []);

  const loadSyncStatus = useCallback(async () => {
    try {
      const status = await apiClient.getSyncStatus();
      setSyncStatus(status);
    } catch (err) {
      console.error('Failed to load sync status:', err);
    }
  }, []);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        setLoading(true);
        const data = await apiClient.getGenerationSettings();
        const loaded = {
          auto_generation_enabled: data.auto_generation_enabled,
          update_interval_minutes: data.update_interval_minutes,
          include_private_contributions: data.include_private_contributions,
        };
        setSettings(loaded);
        setDateRange(String(data.date_range_days));
        setSavedSnapshot({ ...loaded, date_range: String(data.date_range_days) });
        setLoadError(null);
      } catch (err) {
        setLoadError(err.message);
      } finally {
        setLoading(false);
      }
    };
    loadSettings();
    loadSyncStatus();
    loadPlatforms();
  }, [loadSyncStatus, loadPlatforms]);

  const platformsDirty = platforms.some((p) => {
    const saved = savedPlatforms[p.id];
    if (!saved) return false;
    const cur = prefsOf(p);
    return cur.sync_profile !== saved.sync_profile || cur.sync_contributions !== saved.sync_contributions;
  });
  const settingsDirty =
    savedSnapshot !== null &&
    (settings.auto_generation_enabled !== savedSnapshot.auto_generation_enabled ||
      settings.update_interval_minutes !== savedSnapshot.update_interval_minutes ||
      settings.include_private_contributions !== savedSnapshot.include_private_contributions ||
      dateRange !== savedSnapshot.date_range);
  const dirty = platformsDirty || settingsDirty;

  const updateSettings = (patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    setSaveError(null);
  };

  const updatePlatformPref = (platformId, patch) => {
    setPlatforms((prev) => prev.map((p) => (p.id === platformId ? { ...p, ...patch } : p)));
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

  const handleSave = async () => {
    const rangeError = validateDateRange(dateRange);
    setDateRangeError(rangeError);
    if (rangeError) {
      setSaveError('Please fix the highlighted field before saving.');
      return;
    }

    const invalid = platforms.find((p) => !p.sync_profile && !p.sync_contributions);
    if (invalid) {
      setSaveError(
        `At least one sync type must be enabled for ${invalid.platform} (Profile or Heatmap + Activities).`
      );
      return;
    }

    try {
      setSaving(true);
      setSaveError(null);

      // Platform preferences first: enabling auto sync requires one sync type to be on
      const changed = platforms.filter((p) => {
        const saved = savedPlatforms[p.id];
        const cur = prefsOf(p);
        return saved && (cur.sync_profile !== saved.sync_profile || cur.sync_contributions !== saved.sync_contributions);
      });
      for (const p of changed) {
        await apiClient.updatePlatformSyncPreferences(p.id, prefsOf(p));
      }
      setSavedPlatforms(Object.fromEntries(platforms.map((p) => [p.id, prefsOf(p)])));

      await apiClient.updateGenerationSettings({
        ...settings,
        date_range_days: Number(dateRange),
      });
      setSavedSnapshot({ ...settings, date_range: dateRange });

      toast.success('Sync settings saved');
      await loadSyncStatus();
    } catch (err) {
      setSaveError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const formatDateTime = (dateStr) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  if (loading) {
    return <div className="sync-container"><div className="sync-loading">Loading settings...</div></div>;
  }

  const intervalOptions = INTERVAL_OPTIONS.some((o) => o.value === settings.update_interval_minutes)
    ? INTERVAL_OPTIONS
    : [
        ...INTERVAL_OPTIONS,
        { value: settings.update_interval_minutes, label: `Every ${settings.update_interval_minutes} minutes` },
      ].sort((a, b) => a.value - b.value);

  return (
    <div className="sync-container">
      <div className="sync-header">
        <h1>Sync</h1>
        <p className="sync-subtitle">Configure automatic background syncing of your git platforms</p>
        <p className="sync-hint">
          To sync manually, go to <Link to={user ? `/${user.username}` : '/'} className="sync-inline-link">Dashboard → Platforms</Link>.
        </p>
      </div>

      {loadError && <div className="sync-error" role="alert">{loadError}</div>}

      {/* Sync Status - Read Only */}
      {syncStatus && (
        <section className="sync-card">
          <h2>Sync Status</h2>
          <div className="sync-status-grid">
            <div className="sync-status-item">
              <span className="sync-status-label">Auto Sync</span>
              <span className={syncStatus.auto_sync_enabled ? 'status-enabled' : 'status-disabled'}>
                {syncStatus.auto_sync_enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div className="sync-status-item">
              <span className="sync-status-label">Last Sync</span>
              <span>{formatDateTime(syncStatus.last_sync)}</span>
            </div>
            {syncStatus.auto_sync_enabled && (
              <div className="sync-status-item">
                <span className="sync-status-label">Next Sync</span>
                <span>{syncStatus.next_scheduled_generation_at ? formatDateTime(syncStatus.next_scheduled_generation_at) : formatDateTime(syncStatus.next_sync)}</span>
              </div>
            )}
            <div className="sync-status-item">
              <span className="sync-status-label">Sync Interval</span>
              <span>{syncStatus.update_interval_minutes} minutes</span>
            </div>
          </div>

          {syncStatus.platform_accounts && syncStatus.platform_accounts.length > 0 && (
            <div className="sync-platforms-status">
              <h3>Connected Platforms</h3>
              <p className="sync-hint">These platforms will be included in automatic syncing</p>
              <div className="sync-platforms-list">
                {syncStatus.platform_accounts.map((platform, idx) => (
                  <div key={idx} className="sync-platform-item">
                    <div className="sync-platform-name">
                      <strong>{platform.platform}</strong>: {platform.username}
                    </div>
                    <div className="sync-platform-sync">
                      Last synced: {formatDateTime(platform.last_synced)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Per-Platform Sync Preferences */}
      {platforms && platforms.length > 0 && (
        <section className="sync-card">
          <h2>What to Sync</h2>
          <p className="sync-subtitle">Choose which data to sync for each platform. Changes are applied when you press Save.</p>

          {platforms.map((platform) => (
            <div key={platform.id} className="sync-platform-prefs">
              <div className="sync-platform-info">
                <strong>{platform.platform}</strong>: {platform.platform_username}
                {platform.last_synced_at && (
                  <span className="sync-last-synced">
                    {' '}• Last synced: {formatDateTime(platform.last_synced_at)}
                  </span>
                )}
              </div>

              <div className="sync-checkboxes">
                <div className="sync-toggle-row">
                  <label className="sync-toggle-text" htmlFor={`sync-profile-${platform.id}`}>
                    Profile <span className="sync-hint-inline">(avatar, bio, followers)</span>
                  </label>
                  <label className="toggle-switch">
                    <input
                      id={`sync-profile-${platform.id}`}
                      type="checkbox"
                      checked={platform.sync_profile}
                      onChange={(e) => updatePlatformPref(platform.id, { sync_profile: e.target.checked })}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>

                <div className="sync-toggle-row">
                  <label className="sync-toggle-text" htmlFor={`sync-contrib-${platform.id}`}>
                    Heatmap + Activities <span className="sync-hint-inline">(contributions and timeline events)</span>
                  </label>
                  <label className="toggle-switch">
                    <input
                      id={`sync-contrib-${platform.id}`}
                      type="checkbox"
                      checked={platform.sync_contributions}
                      onChange={(e) => updatePlatformPref(platform.id, { sync_contributions: e.target.checked })}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Auto Sync Configuration */}
      <section className="sync-card">
        <h2>When to Sync</h2>
        <p className="sync-subtitle">Configure the automatic background sync schedule</p>

        <div className="sync-row">
          <div className="sync-row-info">
            <label className="sync-label" htmlFor="sync-auto">Enable automatic background sync</label>
            <p className="sync-hint">
              When enabled, your git platform data is synced in the background at the interval below.
            </p>
          </div>
          <label className="toggle-switch">
            <input
              id="sync-auto"
              type="checkbox"
              checked={settings.auto_generation_enabled}
              onChange={(e) => updateSettings({ auto_generation_enabled: e.target.checked })}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>

        {settings.auto_generation_enabled && (
          <div className="sync-field">
            <label className="sync-label" htmlFor="sync-interval">Sync interval</label>
            <select
              id="sync-interval"
              value={settings.update_interval_minutes}
              onChange={(e) => updateSettings({ update_interval_minutes: parseInt(e.target.value, 10) })}
            >
              {intervalOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="sync-hint">
              How often to fetch new data from your connected platforms (syncs current year only)
            </p>
          </div>
        )}

        <div className="sync-field">
          <label className="sync-label" htmlFor="sync-range">Heatmap date range (days)</label>
          <input
            id="sync-range"
            type="number"
            inputMode="numeric"
            value={dateRange}
            min={MIN_DATE_RANGE}
            max={MAX_DATE_RANGE}
            aria-invalid={dateRangeError ? 'true' : undefined}
            aria-describedby={dateRangeError ? 'sync-range-error' : undefined}
            className={dateRangeError ? 'sync-input-invalid' : undefined}
            onChange={(e) => {
              setDateRange(e.target.value);
              setDateRangeError(null);
              setSaveError(null);
            }}
          />
          {dateRangeError && (
            <p className="sync-field-error" id="sync-range-error" role="alert">{dateRangeError}</p>
          )}
          <p className="sync-hint">
            Number of days to include in your heatmap ({MIN_DATE_RANGE}-{MAX_DATE_RANGE} days). Shared with the Generation page.
          </p>
        </div>

        <div className="sync-row">
          <div className="sync-row-info">
            <label className="sync-label" htmlFor="sync-private">
              Include private contributions in generated heatmaps
            </label>
            <p className="sync-hint">
              Same option as on the Generation page. It has no effect unless{' '}
              <Link to="/settings" className="sync-inline-link">Show Private Contributions</Link> is
              enabled in Preferences, which is the global setting.
            </p>
          </div>
          <label className="toggle-switch">
            <input
              id="sync-private"
              type="checkbox"
              checked={settings.include_private_contributions}
              onChange={(e) => updateSettings({ include_private_contributions: e.target.checked })}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>

        <div className="sync-actions">
          {saveError ? (
            <div className="sync-error sync-error-inline" role="alert">{saveError}</div>
          ) : (
            dirty && <span className="sync-dirty" role="status">Unsaved changes</span>
          )}
          <button
            type="button"
            className="sync-btn-primary"
            onClick={handleSave}
            disabled={saving || !dirty}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </section>
    </div>
  );
}

export default SyncSettings;

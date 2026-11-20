import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiEdit, FiCopy, FiRefreshCw, FiStar, FiTrash2 } from 'react-icons/fi';
import apiClient from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../context/ToastContext';
import { slugify } from '../utils/slug';
import './HeatmapThemes.css';

function HeatmapThemes() {
  const navigate = useNavigate();
  const toast = useToast();
  const [dialog, setDialog] = useState(null);
  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [generatedHeatmaps, setGeneratedHeatmaps] = useState([]);
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  useEffect(() => {
    loadThemes();
    loadGeneratedHeatmaps();
  }, []);

  const loadThemes = async () => {
    try {
      setLoading(true);
      const data = await apiClient.listThemes();
      setThemes(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadGeneratedHeatmaps = async () => {
    try {
      const data = await apiClient.listGeneratedHeatmaps();
      setGeneratedHeatmaps(data);
    } catch (err) {
      console.error('Failed to load generated heatmaps:', err);
    }
  };

  const handleDelete = (slug, themeName) => {
    setDialog({
      title: 'Delete theme',
      message: `Are you sure you want to delete theme "${themeName}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        setDialog(null);
        try {
          await apiClient.deleteTheme(slug);
          await loadThemes();
          toast.success(`Theme "${themeName}" deleted`);
        } catch (err) {
          toast.error(`Failed to delete theme: ${err.message}`);
        }
      },
    });
  };

  const handleSetDefault = async (slug) => {
    try {
      await apiClient.setDefaultTheme(slug);
      await loadThemes();
    } catch (err) {
      toast.error(`Failed to set default theme: ${err.message}`);
    }
  };

  const handleGenerate = async (theme) => {
    if (!theme.output_formats || theme.output_formats.length === 0) {
      toast.error('This theme has no output formats. Edit it and select at least one format.');
      return;
    }
    try {
      await apiClient.triggerThemeGeneration(theme.slug);
      toast.success('Heatmap generation started! Check the generation jobs for status.');
    } catch (err) {
      toast.error(`Failed to trigger generation: ${err.message}`);
    }
  };

  const handleDuplicate = (slug, themeName) => {
    setDialog({
      title: 'Duplicate theme',
      inputLabel: 'Name for the duplicated theme',
      defaultValue: `${themeName} (Copy)`,
      confirmLabel: 'Duplicate',
      validate: (value) => {
        const newSlug = slugify(value);
        if (!newSlug) return 'Enter a valid theme name';
        if (themes.some(t => t.slug === newSlug)) return 'A theme with this name already exists';
        return null;
      },
      onConfirm: async (newName) => {
        setDialog(null);
        try {
          await apiClient.duplicateTheme(slug, newName.trim(), slugify(newName));
          await loadThemes();
          toast.success(`Theme "${newName.trim()}" duplicated successfully`);
        } catch (err) {
          toast.error(`Failed to duplicate theme: ${err.message}`);
        }
      },
    });
  };

  const getEmbedUrl = (slug, format) => {
    return apiClient.getHeatmapEmbedUrl(user.username, slug, format);
  };

  if (loading) {
    return (
      <div className="heatmap-themes-container">
        <div className="loading">Loading themes...</div>
      </div>
    );
  }

  return (
    <div className="heatmap-themes-container">
      <div className="themes-header">
        <h1>Heatmap Themes</h1>
        <div className="header-actions">
          <button
            className="btn-secondary"
            onClick={() => navigate('/settings/generation')}
          >
            Generation Settings
          </button>
          <button
            className="btn-primary"
            onClick={() => navigate('/settings/themes/new')}
          >
            + New Theme
          </button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {themes.length === 0 ? (
        <div className="empty-state">
          <p>No themes found. Create your first heatmap theme!</p>
          <button
            className="btn-primary"
            onClick={() => navigate('/settings/themes/new')}
          >
            Create Theme
          </button>
        </div>
      ) : (
        <div className="themes-grid">
          {themes.map((theme) => (
            <div key={theme.id} className="theme-card">
              <div className="theme-card-header">
                <h3>
                  {theme.name}
                  {theme.is_default && (
                    <span className="badge-default">Default</span>
                  )}
                </h3>
                <span className={`theme-mode-badge ${theme.theme_mode}`}>
                  {theme.theme_mode}
                </span>
              </div>

              {theme.description && (
                <p className="theme-description">{theme.description}</p>
              )}

              <div className="theme-details">
                <div className="detail-row">
                  <span className="label">Color Scheme:</span>
                  <span className="value">{theme.color_scheme.replace('_', ' ')}</span>
                </div>
                <div className="detail-row">
                  <span className="label">Cell Size:</span>
                  <span className="value">{theme.cell_size}px</span>
                </div>
                <div className="detail-row">
                  <span className="label">Formats:</span>
                  <span className="value">{theme.output_formats.join(', ').toUpperCase()}</span>
                </div>
                <div className="detail-row">
                  <span className="label">Slug:</span>
                  <span className="value monospace">{theme.slug}</span>
                </div>
              </div>

              {/* Preview Image if generated */}
              {generatedHeatmaps.find(
                h => h.theme_id === theme.id && h.is_valid
              ) && (
                  <div className="theme-preview">
                    <img
                      src={getEmbedUrl(theme.slug, theme.output_formats[0])}
                      alt={`${theme.name} preview`}
                      onError={(e) => {
                        e.target.style.display = 'none';
                      }}
                    />
                  </div>
                )}

              <div className="theme-actions">
                <button
                  className="btn-icon"
                  onClick={() => navigate(`/settings/themes/${theme.slug}/edit`)}
                  title="Edit theme"
                >
                  <FiEdit />
                </button>
                <button
                  className="btn-icon"
                  onClick={() => handleDuplicate(theme.slug, theme.name)}
                  title="Duplicate theme"
                >
                  <FiCopy />
                </button>
                <button
                  className="btn-icon"
                  onClick={() => handleGenerate(theme)}
                  title="Generate heatmap"
                >
                  <FiRefreshCw />
                </button>
                {!theme.is_default && (
                  <button
                    className="btn-icon"
                    onClick={() => handleSetDefault(theme.slug)}
                    title="Set as default"
                  >
                    <FiStar />
                  </button>
                )}
                {!theme.is_default && (
                  <button
                    className="btn-icon btn-danger"
                    onClick={() => handleDelete(theme.slug, theme.name)}
                    title="Delete theme"
                  >
                    <FiTrash2 />
                  </button>
                )}
              </div>

              {/* Embed URLs */}
              <div className="embed-urls">
                <h4>Embed URLs:</h4>
                {theme.output_formats.map(format => (
                  <div key={format} className="embed-url-row">
                    <code>{getEmbedUrl(theme.slug, format)}</code>
                    <button
                      className="btn-copy"
                      onClick={() => {
                        navigator.clipboard.writeText(getEmbedUrl(theme.slug, format))
                          .then(() => toast.success('Copied to clipboard'))
                          .catch(() => toast.error('Could not copy to clipboard'));
                      }}
                      title="Copy to clipboard"
                    >
                      <FiCopy />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {dialog && <ConfirmDialog {...dialog} onCancel={() => setDialog(null)} />}
    </div>
  );
}

export default HeatmapThemes;

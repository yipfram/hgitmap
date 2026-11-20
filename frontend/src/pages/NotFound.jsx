import { Link } from 'react-router-dom';
import HeatmapLogo from '../components/HeatmapLogo';
import ThemeToggle from '../components/ThemeToggle';
import useDocumentTitle from '../hooks/useDocumentTitle';
import './Auth.css';

const NotFound = ({ title = 'Page not found', message = "The page you're looking for doesn't exist." }) => {
  useDocumentTitle('Not found');

  return (
    <div className="auth-container">
      <div className="theme-toggle-wrapper">
        <ThemeToggle />
      </div>
      <div className="auth-box" style={{ textAlign: 'center' }}>
        <Link to="/" aria-label="Hgitmap home" style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
          <HeatmapLogo size={48} />
        </Link>
        <h1>{title}</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>{message}</p>
        <div className="auth-footer">
          <Link to="/">Back to home</Link>
        </div>
      </div>
    </div>
  );
};

export default NotFound;

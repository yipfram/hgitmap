import { useEffect } from 'react';

export const APP_NAME = 'Hgitmap';
export const DEFAULT_TITLE = `${APP_NAME} - Visualize Your Git Contributions`;

// Sets document.title to "<title> – Hgitmap" while mounted; falls back to the default title.
export default function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} – ${APP_NAME}` : DEFAULT_TITLE;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}

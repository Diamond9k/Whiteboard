import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme } from './lib/storage';
import './styles.css';

try {
  const saved = localStorage.getItem('bbx-theme');
  applyTheme(saved === 'dark' || saved === 'system' ? saved : 'light');
} catch { /* private mode */ }

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);

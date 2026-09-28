import { Moon, Sun } from 'lucide-react';
import { t } from '../i18n/index.js';
import { setTheme, useTheme } from './theme.js';

export function ThemeToggle() {
  const theme = useTheme();
  const label = theme === 'dark' ? t('Switch to light theme') : t('Switch to dark theme');
  return <button type="button" className="icon-button theme-toggle" aria-label={label} title={label} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
    {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
  </button>;
}

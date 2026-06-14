import { useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { getTheme, setTheme, type Theme } from '../lib/theme';

/** Light/Dark theme toggle pill, styled to match the dashboard topbar buttons. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, set] = useState<Theme>(() => getTheme());
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    set(next);
    setTheme(next);
  };
  return (
    <button
      type="button"
      onClick={toggle}
      className={`panel-btn no-drag !h-8 !px-3 whitespace-nowrap ${className}`}
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {theme === 'dark' ? <Sun size={14} className="mr-1.5" /> : <Moon size={14} className="mr-1.5" />}
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}

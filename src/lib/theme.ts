export type Theme = 'dark' | 'light';

const KEY = 'tcm-theme';

export function getTheme(): Theme {
  const fromQuery = new URLSearchParams(window.location.search).get('theme');
  if (fromQuery === 'light' || fromQuery === 'dark') return fromQuery;
  const stored = localStorage.getItem(KEY);
  return stored === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

export function initTheme(): void {
  applyTheme(getTheme());
}

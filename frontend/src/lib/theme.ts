import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'pdf-studio-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

const saved = (): Theme | null => {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : null;
};
let current: Theme = saved() ?? (media.matches ? 'dark' : 'light');

function apply(t: Theme, animate: boolean) {
  const root = document.documentElement;
  if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('theme-fade');
    window.setTimeout(() => root.classList.remove('theme-fade'), 400);
  }
  root.dataset.theme = t;
  current = t;
  listeners.forEach((l) => l());
}

/** Call once before the first render so there is no flash of the wrong theme. */
export function initTheme() {
  apply(current, false);
  // Follow the system until the user picks a theme themselves.
  media.addEventListener('change', (e) => {
    if (!saved()) apply(e.matches ? 'dark' : 'light', true);
  });
}

export function toggleTheme() {
  const next: Theme = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem(KEY, next);
  apply(next, true);
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

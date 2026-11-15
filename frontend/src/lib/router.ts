import { useSyncExternalStore } from 'react';

/** Tiny history router: "/" is the library, "/doc/<id>" the editor. Back/forward just work. */
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
window.addEventListener('popstate', emit);

export function navigate(path: string, replace = false) {
  if (path === location.pathname) return;
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  emit();
}

export function usePath(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => location.pathname,
  );
}

export const docIdOf = (path: string) => /^\/doc\/([\w-]+)/.exec(path)?.[1] ?? null;

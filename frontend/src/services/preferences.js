/*
 * Client-side display preferences (screen 22 reduced to Language and Theme, spec 005 D-05). Stored in localStorage only:
 * they are per-viewer conveniences, never sent to the server, and the page renders correctly when storage is unavailable.
 */
const THEME_KEY = 'santulan.theme';
const MOTION_KEY = 'santulan.reduceMotion';
export const THEMES = ['light', 'dark'];

const read = (key) => { try { return localStorage.getItem(key); } catch (err) { return null; } };
const write = (key, value) => { try { localStorage.setItem(key, value); } catch (err) { /* keep the in-memory choice for this page */ } };

export const getTheme = () => (THEMES.includes(read(THEME_KEY)) ? read(THEME_KEY) : 'light');
export const getReduceMotion = () => read(MOTION_KEY) === 'true';

/** Applies the stored (or given) preferences to the document root; call once at start-up and after every change. */
export function applyPreferences({ theme = getTheme(), reduceMotion = getReduceMotion() } = {}) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-reduce-motion', reduceMotion ? 'true' : 'false');
}

export function setTheme(theme) {
  if (!THEMES.includes(theme)) return;
  write(THEME_KEY, theme);
  applyPreferences({ theme });
}

export function setReduceMotion(value) {
  write(MOTION_KEY, value ? 'true' : 'false');
  applyPreferences({ reduceMotion: value });
}

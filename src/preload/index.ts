import { exposeLvbAPI } from './bridge';

// Apply the persisted theme mode before the first render so light-mode windows
// don't flash the dark default while the async settings read resolves.
try {
  const arg = process.argv.find((item) => item.startsWith('--theme-mode='));
  const mode = arg && arg.endsWith('=light') ? 'light' : 'dark';
  const applyMode = () => {
    if (document.documentElement) document.documentElement.dataset.theme = mode;
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyMode, { once: true });
  } else {
    applyMode();
  }
} catch {
  // ignore — renderer will apply the theme once settings load
}

// Expose the VibeKit API to all renderer processes
exposeLvbAPI();

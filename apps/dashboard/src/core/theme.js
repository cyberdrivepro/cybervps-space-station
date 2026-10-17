/**
 * CYBERVPS SPACE STATION - THEME ENGINE
 * Cyberpunk, Obsidian Dragon, and Terminal Themes
 */

class StationTheme {
  static themes = {
    cyberpunk: {
      '--bg-primary': '#080c14',
      '--bg-secondary': '#0f1624',
      '--bg-card': '#141e30',
      '--border-color': 'rgba(0, 255, 204, 0.15)',
      '--border-focus': '#00ffcc',
      '--accent-cyan': '#00ffcc',
      '--accent-purple': '#bd00ff',
      '--accent-amber': '#ffaa00',
      '--text-main': '#e2e8f0',
      '--text-muted': '#94a3b8'
    },
    obsidian: {
      '--bg-primary': '#06060a',
      '--bg-secondary': '#0d0d14',
      '--bg-card': '#13131f',
      '--border-color': 'rgba(168, 85, 247, 0.2)',
      '--border-focus': '#a855f7',
      '--accent-cyan': '#c084fc',
      '--accent-purple': '#9333ea',
      '--accent-amber': '#fbbf24',
      '--text-main': '#f1f5f9',
      '--text-muted': '#a1a1aa'
    },
    terminal: {
      '--bg-primary': '#070a07',
      '--bg-secondary': '#0c140c',
      '--bg-card': '#111c11',
      '--border-color': 'rgba(34, 197, 94, 0.25)',
      '--border-focus': '#22c55e',
      '--accent-cyan': '#4ade80',
      '--accent-purple': '#16a34a',
      '--accent-amber': '#eab308',
      '--text-main': '#dcfce7',
      '--text-muted': '#86efac'
    }
  };

  static applyTheme(themeName = 'cyberpunk') {
    const theme = this.themes[themeName] || this.themes.cyberpunk;
    const root = document.documentElement;

    for (const [prop, val] of Object.entries(theme)) {
      root.style.setProperty(prop, val);
    }
    localStorage.setItem('cvps_theme', themeName);
  }

  static getSavedTheme() {
    return localStorage.getItem('cvps_theme') || 'cyberpunk';
  }
}

if (typeof window !== 'undefined') {
  window.StationTheme = StationTheme;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StationTheme;
}

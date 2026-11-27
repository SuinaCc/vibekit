import type { Config } from 'tailwindcss';

export default {
  content: [
    './src/renderer/index.html',
    './src/renderer/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: 'var(--color-surface)',
          elevated: 'var(--color-surface-elevated)',
          glass: 'var(--color-surface-glass)',
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
          glow: 'var(--color-accent-glow)',
          light: 'var(--color-accent-light)',
          dark: 'var(--color-accent-dark)',
        },
        text: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          muted: 'var(--color-text-muted)',
        },
        border: {
          DEFAULT: 'var(--color-border)',
          hover: 'var(--color-border-hover)',
        },
      },
      borderRadius: {
        glass: '16px',
        'glass-lg': '24px',
      },
      backdropBlur: {
        glass: '20px',
      },
      animation: {
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
        'float-in': 'float-in 0.2s ease-out',
        'slide-up': 'slide-up 0.15s ease-out',
      },
      keyframes: {
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 20px var(--color-accent-glow)' },
          '50%': { boxShadow: '0 0 40px var(--color-accent-glow)' },
        },
        'float-in': {
          from: { opacity: '0', transform: 'scale(0.95) translateY(-10px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;

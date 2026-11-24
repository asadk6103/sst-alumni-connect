import type { Config } from 'tailwindcss';

// Colours are CSS variables (space-separated RGB) filled from the published branding at runtime.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: v('navy'), dark: v('navy-dark') },
        primary: { DEFAULT: v('primary'), soft: v('primary-light'), fg: '#fff' },
        secondary: v('secondary'),
        surface: v('surface'),
        canvas: v('canvas'),
        ink: { DEFAULT: v('ink'), muted: v('ink-muted') },
        line: v('line'),
        success: v('success'),
        warning: v('warning'),
        danger: v('danger'),
      },
      fontFamily: {
        sans: ['var(--font-body)', 'Inter Variable', 'Inter', 'system-ui', 'sans-serif'],
        heading: ['var(--font-heading)', 'Poppins', 'Inter Variable', 'system-ui', 'sans-serif'],
      },
      borderRadius: { btn: 'var(--radius-btn)', card: 'var(--radius-card)' },
      boxShadow: {
        card: '0 1px 2px rgb(16 35 68 / 0.04), 0 2px 8px rgb(16 35 68 / 0.05)',
        pop: '0 10px 30px rgb(16 35 68 / 0.14)',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: { shimmer: 'shimmer 1.4s infinite' },
    },
  },
  plugins: [],
} satisfies Config;

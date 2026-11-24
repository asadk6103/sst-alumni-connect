import type { Config } from 'tailwindcss';

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: v('navy'), dark: v('navy-dark') },
        primary: { DEFAULT: v('primary'), soft: v('primary-light') },
        secondary: v('secondary'),
        surface: v('surface'),
        canvas: v('canvas'),
        ink: { DEFAULT: v('ink'), muted: v('ink-muted') },
        line: v('line'),
        success: v('success'),
      },
      fontFamily: {
        sans: ['var(--font-body)', 'Inter Variable', 'Inter', 'system-ui', 'sans-serif'],
        heading: ['var(--font-heading)', 'Poppins', 'system-ui', 'sans-serif'],
      },
      borderRadius: { btn: 'var(--radius-btn)', card: 'var(--radius-card)' },
      boxShadow: { card: '0 1px 2px rgb(16 35 68 / 0.04), 0 2px 8px rgb(16 35 68 / 0.05)' },
    },
  },
  plugins: [],
} satisfies Config;

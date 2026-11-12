/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Radii come from the active theme (Terminal is fully square), so every rounded-* follows it.
      borderRadius: {
        lg: 'var(--r-sm)',
        xl: 'var(--r-md)',
        '2xl': 'var(--r-md)',
        '3xl': 'var(--r-card)',
      },
    },
  },
  plugins: [],
}

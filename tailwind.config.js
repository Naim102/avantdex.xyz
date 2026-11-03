/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Neo-brutalist radii: tighter than the Tailwind defaults so thick borders read as intentional
      borderRadius: {
        xl: '0.7rem',
        '2xl': '0.85rem',
        '3xl': '1.1rem',
      },
    },
  },
  plugins: [],
}

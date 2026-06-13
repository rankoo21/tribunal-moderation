/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        paper: '#0c0b09',
        ink: '#ECE7DC',
        muted: '#8C8576',
        line: '#26241F',
        accent: '#C8462C', // vermilion seal
      },
    },
  },
  plugins: [],
};

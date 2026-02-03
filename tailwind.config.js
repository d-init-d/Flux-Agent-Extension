/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/sidebar/index.html",
    "./src/sidebar/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: '#0f172a',
          light: '#1e293b'
        },
        foreground: '#f1f5f9',
        primary: {
          DEFAULT: '#3b82f6',
          hover: '#2563eb'
        },
        secondary: '#64748b',
        accent: '#8b5cf6'
      }
    },
  },
  plugins: [],
}

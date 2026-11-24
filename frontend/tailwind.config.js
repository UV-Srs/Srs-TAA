/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Poppins', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          DEFAULT: "#2B5C8F",
          dark: "#234C77",
          soft: "#EAF1F8",
        },
        canvas: "#F1F4F8",
        industrial: {
          white: "#FFFFFF",
          tint: "#F4F4F5",
          border: "#000000",
          dimmed: "#D4D4D8",
          black: "#000000",
          charcoal: "#111111",
        }
      }
    },
  },
  plugins: [],
}

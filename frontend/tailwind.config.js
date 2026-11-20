/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
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

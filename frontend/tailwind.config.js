/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Poppins', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        ls: {
          bg: "var(--bg)",
          surface: "var(--surface)",
          surface2: "var(--surface2)",
          ink: "var(--ink)",
          muted: "var(--muted)",
          line: "var(--line)",
          line2: "var(--line2)",
          primary: "var(--primary)",
          accent: "var(--accent)",
          accentSoft: "var(--accent-soft)",
          ok: "var(--ok)",
          okBg: "var(--ok-bg)",
          warn: "var(--warn)",
          warnBg: "var(--warn-bg)",
          ng: "var(--ng)",
          ngBg: "var(--ng-bg)",
        },
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

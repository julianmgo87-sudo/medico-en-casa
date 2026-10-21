import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Azul médico (principal) y turquesa (secundario)
        brand: {
          50: "#eef6ff", 100: "#d9eaff", 200: "#bcd9ff", 300: "#8ec1ff", 400: "#599dfc",
          500: "#3479f6", 600: "#1d5deb", 700: "#1648d0", 800: "#183ca9", 900: "#1a3785", 950: "#142351",
        },
        teal: {
          50: "#effefb", 100: "#c8fff4", 200: "#91feea", 300: "#52f5dc", 400: "#1ee0c8",
          500: "#06c4af", 600: "#019e8f", 700: "#067e74", 800: "#0a645e", 900: "#0d534e", 950: "#003331",
        },
        ink: { DEFAULT: "#0f1f3a", soft: "#475569", faint: "#94a3b8" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: { "2xl": "1.25rem", "3xl": "1.75rem" },
      boxShadow: {
        card: "0 1px 2px rgba(15,31,58,.04), 0 8px 24px -12px rgba(15,31,58,.12)",
        lift: "0 2px 4px rgba(15,31,58,.06), 0 20px 40px -20px rgba(22,72,208,.35)",
      },
    },
  },
  plugins: [],
} satisfies Config;

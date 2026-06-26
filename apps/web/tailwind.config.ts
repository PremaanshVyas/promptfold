import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: "#2f7f7a",
        sand: "#f6f6f7",
      },
    },
  },
  plugins: [],
} satisfies Config;

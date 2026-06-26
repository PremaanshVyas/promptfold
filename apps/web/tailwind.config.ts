import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        clay: "#c96442",
        sand: "#faf9f7",
      },
    },
  },
  plugins: [],
} satisfies Config;

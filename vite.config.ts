import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative asset paths, so the build works under any GitHub Pages path (/<repo>/).
  base: "./",
  plugins: [react()],
  test: {
    include: ["src/**/*.test.ts"],
  },
} as any);

import { configDefaults, defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    // The WhatsApp gateway is its own Node project with node:test tests (npm test there).
    exclude: [...configDefaults.exclude, "scraper/whatsapp-gateway/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

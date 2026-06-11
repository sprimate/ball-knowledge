import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  base: "/ball-knowledge/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        matchup: resolve(__dirname, "matchup.html"),
        data: resolve(__dirname, "data.html"),
        bracket: resolve(__dirname, "bracket.html"),
      },
    },
  },
});

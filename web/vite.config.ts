import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: "dist",
  },
  server: {
    proxy: {
      // 開発時は Express (server/) を別プロセスで起動し、/api を素通しする
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@app": path.resolve(__dirname, "src/app"),
      "@layouts": path.resolve(__dirname, "src/app/layouts"),
      "@modules": path.resolve(__dirname, "src/app/modules"),
      "@providers": path.resolve(__dirname, "src/app/providers"),
      "@routes": path.resolve(__dirname, "src/app/routes"),

      "@assets": path.resolve(__dirname, "src/assets"),

      "@shared": path.resolve(__dirname, "src/shared"),
      "@errors": path.resolve(__dirname, "src/shared/errors"),
      "@gateways": path.resolve(__dirname, "src/shared/gateways"),
      "@helpers": path.resolve(__dirname, "src/shared/helpers"),
      "@ui": path.resolve(__dirname, "src/shared/ui"),
      "@contracts": path.resolve(__dirname, "shared/schemas"),
    }
  }
});
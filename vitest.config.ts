import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Deno tests run separately with their own runtime and permission sandbox.
export default mergeConfig(viteConfig, defineConfig({
  test: { include: ["tests/unit/**/*.test.ts"] },
}));

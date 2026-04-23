import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5173",
    port: 5173,
    timeout: 120_000,
    reuseExistingServer: true
  }
});

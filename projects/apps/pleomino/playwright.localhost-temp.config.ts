export default {
  testDir: "./e2e",
  testMatch: "**/prod-reload-offline-temp.e2e.ts",
  timeout: 60000,
  expect: { timeout: 5000 },
  use: {
    baseURL: "http://localhost:4173",
    viewport: { width: 1400, height: 900 },
  },
};

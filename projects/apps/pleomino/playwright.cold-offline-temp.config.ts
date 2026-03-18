export default {
  testDir: "./e2e",
  testMatch: "**/cold-offline-solve-temp.e2e.ts",
  timeout: 90000,
  expect: { timeout: 5000 },
  use: {
    baseURL: "http://localhost:4173",
    viewport: { width: 1400, height: 900 },
  },
};

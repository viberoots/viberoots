import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 60_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1400, height: 900 },
  },
  webServer: {
    command: "pnpm run dev:vite -- --host 127.0.0.1 --port 4173",
    cwd: __dirname,
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    env: {
      HOST: "127.0.0.1",
      PORT: "4173",
      HMR_PORT: "4174",
    },
  },
};

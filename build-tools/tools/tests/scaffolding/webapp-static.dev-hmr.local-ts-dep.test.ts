#!/usr/bin/env zx-wrapper
import { after, test } from "node:test";
import { runWebappLocalTsDependencyTest } from "./lib/webapp-local-ts-dep";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200") * 1000;

test(
  "webapp-static dev serves updated local TS dependency source without restart",
  { timeout: TEST_TIMEOUT_MS },
  async () =>
    await runWebappLocalTsDependencyTest({
      appName: "demo-web",
      tempName: "webapp-static-hmr-local-dep",
      template: "webapp-static",
    }),
);

after(() => {
  const code = (process as any).exitCode ?? 0;
  setImmediate(() => process.exit(code));
});

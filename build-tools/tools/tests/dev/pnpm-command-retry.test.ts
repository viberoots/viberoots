import assert from "node:assert/strict";
import { test } from "node:test";
import { runPnpmCommandWithRetry } from "../../dev/update-pnpm-hash/pnpm-command-retry";

test("pnpm command retry: retries bounded command failures", async () => {
  let attempts = 0;
  const logs: string[] = [];
  await runPnpmCommandWithRetry(
    "fetch",
    async () => {
      attempts++;
      if (attempts < 3) throw new Error("transient fetch failure");
    },
    { attempts: 3, delayMs: 0, log: (message) => logs.push(message) },
  );

  assert.equal(attempts, 3);
  assert.deepEqual(logs, [
    "[lockfile] pnpm fetch failed; retrying (2/3)",
    "[lockfile] pnpm fetch failed; retrying (3/3)",
  ]);
});

test("pnpm command retry: preserves final failure", async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      runPnpmCommandWithRetry(
        "install",
        async () => {
          attempts++;
          throw new Error("deterministic install failure");
        },
        { attempts: 2, delayMs: 0 },
      ),
    /deterministic install failure/,
  );

  assert.equal(attempts, 2);
});

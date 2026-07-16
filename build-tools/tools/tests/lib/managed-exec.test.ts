import assert from "node:assert/strict";
import { test } from "node:test";
import { execManaged, testCommandTimeoutMs } from "./test-helpers/managed-exec";

test("managed fixture commands reject invalid timeout budgets", () => {
  assert.equal(testCommandTimeoutMs({}), 600_000);
  assert.equal(testCommandTimeoutMs({ TEST_NIX_TIMEOUT_SECS: "30" }), 30_000);
  assert.throws(
    () => testCommandTimeoutMs({ TEST_NIX_TIMEOUT_SECS: "0" }),
    /integer from 1 to 1800/,
  );
});

test("managed fixture commands stop their process group at timeout", async () => {
  await assert.rejects(
    execManaged("bash", ["--noprofile", "--norc", "-c", "sleep 30"], { timeoutMs: 20 }),
    /timed out after 20ms/,
  );
});

test("managed fixture failures preserve bounded child diagnostics", async () => {
  await assert.rejects(
    execManaged("bash", [
      "--noprofile",
      "--norc",
      "-c",
      "printf production-diagnostic >&2; exit 7",
    ]),
    /exited with code 7\nproduction-diagnostic/,
  );
});

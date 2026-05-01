#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeWranglerPagesDeployError } from "../../deployments/cloudflare-pages-publisher.ts";

test("cloudflare-pages deploy summarizes Cloudflare API auth failures safely", () => {
  const stderr = `
\u001b[31m✘ [ERROR] A request to the Cloudflare API (/memberships) failed.\u001b[0m

  Authentication failed (status: 400) [code: 9106]

  Logs were written to "/var/lib/deployment-host/.config/.wrangler/logs/wrangler.log"
`;
  const summary = summarizeWranglerPagesDeployError("", stderr);
  assert.equal(
    summary,
    "wrangler pages deploy failed: Cloudflare API /memberships: Authentication failed (status: 400) [code: 9106]",
  );
  assert.ok(summary.length <= 500);
});

test("cloudflare-pages deploy ignores Wrangler update banner in summarized failures", () => {
  const stderr = `
wrangler 4.17.0 (update available 4.87.0)

\u001b[31m✘ [ERROR] Project not found. The specified project name does not match any of your existing projects.\u001b[0m

Logs were written to "/var/lib/deployment-host/.config/.wrangler/logs/wrangler.log"
`;
  const summary = summarizeWranglerPagesDeployError("", stderr);
  assert.equal(
    summary,
    "wrangler pages deploy failed: Project not found. The specified project name does not match any of your existing projects.",
  );
});

test("cloudflare-pages deploy preserves Wrangler Pages config validation detail", () => {
  const stderr = `
Running configuration file validation for Pages:

\u001b[31m✘ [ERROR] Configuration file for Pages projects does not support "account_id"\u001b[0m

Logs were written to "/var/lib/deployment-host/.config/.wrangler/logs/wrangler.log"
`;
  const summary = summarizeWranglerPagesDeployError("", stderr);
  assert.equal(
    summary,
    'wrangler pages deploy failed: Running configuration file validation for Pages: Configuration file for Pages projects does not support "account_id"',
  );
});

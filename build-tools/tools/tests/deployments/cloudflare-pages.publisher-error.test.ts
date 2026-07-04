#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cloudflarePagesProviderPublicUrl,
  summarizeWranglerPagesDeployError,
} from "../../deployments/cloudflare-pages-publisher";

test("cloudflare-pages provider URL fallback ignores custom domains", () => {
  assert.equal(
    cloudflarePagesProviderPublicUrl({
      project: "sample-webapp-staging-pages",
    }),
    "https://sample-webapp-staging-pages.pages.dev/",
  );
  assert.equal(
    cloudflarePagesProviderPublicUrl({
      project: "sample-webapp-staging-pages",
      previewBranch: "prv-abc123",
    }),
    "https://prv-abc123.sample-webapp-staging-pages.pages.dev/",
  );
});

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

test("cloudflare-pages deploy strips account ids from Cloudflare API paths", () => {
  const stderr = `
\u001b[31m✘ [ERROR] A request to the Cloudflare API (/accounts/1b911846f80a89272c0dbaf44f5c810f/pages/projects/sample-webapp-staging-pages/deployments) failed.\u001b[0m

  Authentication error (status: 403) [code: 10000]
`;
  const summary = summarizeWranglerPagesDeployError("", stderr);
  assert.equal(
    summary,
    "wrangler pages deploy failed: Cloudflare API /accounts/(account)/pages/projects/sample-webapp-staging-pages/deployments: Authentication error (status: 403) [code: 10000]",
  );
  assert.ok(!summary.includes("1b911846f80a89272c0dbaf44f5c810f"));
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

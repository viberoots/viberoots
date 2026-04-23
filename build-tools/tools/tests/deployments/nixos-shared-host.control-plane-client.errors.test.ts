#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createNixosSharedHostArtifactChallengeViaService,
  submitNixosSharedHostControlPlaneViaService,
} from "../../deployments/nixos-shared-host-control-plane-client.ts";

test("control-plane client reports a missing artifact challenge route clearly", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        createNixosSharedHostArtifactChallengeViaService({
          controlPlaneUrl: "https://deploy.apps.kilty.io",
          token: "token",
          request: {} as any,
        }),
      /does not expose \/api\/v1\/submission-challenges\/artifact/,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("control-plane client preserves non-route errors from submissions", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "unsupported schema version: undefined" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        submitNixosSharedHostControlPlaneViaService({
          controlPlaneUrl: "https://deploy.apps.kilty.io",
          token: "token",
          request: {} as any,
        }),
      /unsupported schema version: undefined/,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

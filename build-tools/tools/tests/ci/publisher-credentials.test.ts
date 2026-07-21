#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readPublisherCredentials, redactPublisherOutput } from "../../ci/publisher-credentials";

test("publisher credentials require a declared private file and backend-specific keys", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "publisher-credentials-"));
  try {
    const valid = path.join(tmp, "attic.json");
    await fsp.writeFile(valid, JSON.stringify({ ATTIC_TOKEN: "test-token" }), { mode: 0o600 });
    assert.deepEqual(
      await readPublisherCredentials({ backend: "attic", file: valid, required: true }),
      { ATTIC_TOKEN: "test-token" },
    );
    await assert.rejects(
      readPublisherCredentials({ backend: "attic", file: "relative.json", required: true }),
      /must be absolute/,
    );
    await assert.rejects(
      readPublisherCredentials({ backend: "cachix", file: "", required: true }),
      /requires --publisher-env-file/,
    );

    const broad = path.join(tmp, "broad.json");
    await fsp.writeFile(broad, JSON.stringify({ AWS_SECRET_ACCESS_KEY: "not-allowed" }), {
      mode: 0o600,
    });
    await assert.rejects(
      readPublisherCredentials({ backend: "attic", file: broad, required: true }),
      /contains an unsupported key/,
    );

    const publicFile = path.join(tmp, "public.json");
    await fsp.writeFile(publicFile, JSON.stringify({ CACHIX_AUTH_TOKEN: "test-token" }), {
      mode: 0o644,
    });
    await assert.rejects(
      readPublisherCredentials({ backend: "cachix", file: publicFile, required: true }),
      /mode 0600/,
    );

    const symlink = path.join(tmp, "link.json");
    await fsp.symlink(valid, symlink);
    await assert.rejects(
      readPublisherCredentials({ backend: "attic", file: symlink, required: true }),
      /ELOOP|symbolic link/,
    );
    assert.deepEqual(
      await readPublisherCredentials({ backend: "cachix", file: "", required: false }),
      {},
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("publisher output redacts every admitted credential value", () => {
  const credentials = {
    CACHIX_AUTH_TOKEN: "token-value",
    CACHIX_SIGNING_KEY: "longer-token-value",
  };
  assert.equal(
    redactPublisherOutput(
      "stdout token-value stderr longer-token-value repeated token-value",
      credentials,
    ),
    "stdout [REDACTED] stderr [REDACTED] repeated [REDACTED]",
  );
});

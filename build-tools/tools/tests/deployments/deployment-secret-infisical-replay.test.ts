#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acquireInfisicalSecret,
  admitInfisicalSecret,
  infisicalSecret,
} from "./deployment-secret-infisical.fixture";
import { startFakeInfisicalServer, type FakeInfisicalSecret } from "./infisical.test-server";

const auth = { clientId: "id", clientSecret: "secret", accessToken: "token" };

async function withAdmittedSecret(
  run: (server: Awaited<ReturnType<typeof startFakeInfisicalServer>>) => Promise<void>,
) {
  const server = await startFakeInfisicalServer(auth, [infisicalSecret()]);
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

async function rejectsReplayMismatch(
  response: Partial<FakeInfisicalSecret> & Record<string, unknown>,
  field: string,
  admittedSecret: FakeInfisicalSecret = infisicalSecret(),
) {
  const server = await startFakeInfisicalServer(auth, [admittedSecret]);
  try {
    const admitted = await admitInfisicalSecret(server.siteUrl);
    server.secrets[0]!.response = response;
    await assert.rejects(
      () => acquireInfisicalSecret({ siteUrl: server.siteUrl, admitted }),
      new RegExp(`no longer resolves exactly for ${field}`),
    );
  } finally {
    await server.close();
  }
}

test("Infisical replay rejects project mismatch", async () => {
  await rejectsReplayMismatch({ projectId: "proj_other" }, "project");
});

test("Infisical replay rejects environment mismatch", async () => {
  await rejectsReplayMismatch({ environment: "staging" }, "environment");
});

test("Infisical replay rejects path mismatch", async () => {
  await rejectsReplayMismatch({ secretPath: "/other" }, "path");
});

test("Infisical replay rejects name mismatch", async () => {
  await rejectsReplayMismatch({ secretName: "other_token" }, "name");
});

test("Infisical replay rejects id mismatch and omitted id", async () => {
  await rejectsReplayMismatch({ id: "sec_2" }, "id");
  await withAdmittedSecret(async (server) => {
    const admitted = await admitInfisicalSecret(server.siteUrl);
    server.secrets[0]!.response = { id: undefined };
    await assert.rejects(
      () => acquireInfisicalSecret({ siteUrl: server.siteUrl, admitted }),
      (error) =>
        error instanceof Error &&
        error.message.includes("missing Infisical replay identity evidence: provider secret id") &&
        error.message.includes(
          "requested selector: proj_123:prod:/deployments/pleomino:cloudflare_api_token",
        ),
    );
  });
});

test("Infisical replay rejects incomplete frozen identity evidence", async () => {
  await withAdmittedSecret(async (server) => {
    const admitted = await admitInfisicalSecret(server.siteUrl);
    await assert.rejects(
      () =>
        acquireInfisicalSecret({
          siteUrl: server.siteUrl,
          admitted: { ...admitted, backendRef: admitted.backendRef.replace(/#sec_1$/, "") },
        }),
      /incomplete Infisical replay reference: provider secret id/,
    );
  });
});

test("Infisical admission freezes returned reference when present", async () => {
  const server = await startFakeInfisicalServer(auth, [
    infisicalSecret({ reference: "infisical-ref-1" }),
  ]);
  try {
    const admitted = await admitInfisicalSecret(server.siteUrl);
    assert.ok(admitted.backendRef.includes("reference=infisical-ref-1"));
  } finally {
    await server.close();
  }
});

test("Infisical replay rejects reference mismatch and omitted reference", async () => {
  const admittedSecret = infisicalSecret({ reference: "infisical-ref-1" });
  await rejectsReplayMismatch({ reference: "infisical-ref-2" }, "reference", admittedSecret);
  await rejectsReplayMismatch({ reference: undefined }, "reference", admittedSecret);
});

test("Infisical replay rejects version mismatch", async () => {
  await rejectsReplayMismatch({ version: "4" }, "version");
});

test("Infisical replay rejects deleted, revoked, and unavailable states", async () => {
  for (const state of [{ deleted: true }, { revoked: true }, { unavailable: true }]) {
    await withAdmittedSecret(async (server) => {
      const admitted = await admitInfisicalSecret(server.siteUrl);
      server.secrets[0]!.response = state;
      await assert.rejects(
        () => acquireInfisicalSecret({ siteUrl: server.siteUrl, admitted }),
        /required secret contract .* is missing/,
      );
    });
  }
});

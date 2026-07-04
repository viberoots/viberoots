#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import {
  createCredentialSink,
  resolveCredentialSinkSelection,
} from "../../deployments/infisical-iac-bootstrap-sink";
import { buildDryRunReport } from "../../deployments/infisical-iac-bootstrap-dry-run";
import { buildCredentialHandoffReport } from "../../deployments/infisical-iac-bootstrap-handoff";
import { macosKeychainCommand } from "../../deployments/sprinkleref-keychain";
import { SprinkleRefLocalFileStore } from "../../deployments/sprinkleref-local-file";

test("local-file backend writes restrictive files and never logs values", async () => {
  const dir = await tmp();
  const file = path.join(dir, "secrets.json");
  const store = new SprinkleRefLocalFileStore(file);
  await store.add("secret://deployments/sample-webapp/staging/token", "secret-value");
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.doesNotMatch(store.describe(), /secret-value/);
});

test("macOS Keychain command construction keeps value as argv not shell text", () => {
  assert.deepEqual(macosKeychainCommand("remove", "svc", "secret://x"), [
    "delete-generic-password",
    "-s",
    "svc",
    "-a",
    "secret://x",
  ]);
  assert.equal(macosKeychainCommand("update", "svc", "secret://x", "value").at(-1), "-U");
});

test("bootstrap credential sink auto uses configured SprinkleRef bootstrap category", async () => {
  const dir = await tmp();
  const config = path.join(dir, "sprinkleref.json");
  await fs.writeFile(
    config,
    JSON.stringify({
      version: 1,
      defaultCategory: "main",
      categories: {
        main: { backend: "local-file", file: path.join(dir, "main.json") },
        bootstrap: { backend: "local-file", file: path.join(dir, "bootstrap.json") },
      },
    }),
  );
  const old = process.env.SPRINKLEREF_CONFIG;
  process.env.SPRINKLEREF_CONFIG = config;
  try {
    const sink = await createCredentialSink({ ...DEFAULT_BOOTSTRAP_ARGS, credentialSink: "auto" });
    const ref = "secret://viberoots/bootstrap/viberoots-iac-bootstrap/client-secret";
    await sink.write(ref, "value", false);
    assert.equal(await sink.read(ref), "value");
    assert.match(sink.describe(), /SprinkleRef bootstrap/);
  } finally {
    if (old === undefined) delete process.env.SPRINKLEREF_CONFIG;
    else process.env.SPRINKLEREF_CONFIG = old;
  }
});

test("explicit local-file sink ignores SprinkleRef config", async () => {
  const dir = await tmp();
  const config = await writeResolverConfig(dir);
  await withEnvConfig(config, async () => {
    const args = { ...DEFAULT_BOOTSTRAP_ARGS, credentialSink: "local-file" as const };
    const selection = await resolveCredentialSinkSelection(args);
    const sink = await createCredentialSink(args);
    assert.equal(selection.kind, "local-file");
    assert.doesNotMatch(sink.describe(), /SprinkleRef/);
  });
});

test("explicit sprinkleref sink uses configured bootstrap category", async () => {
  const dir = await tmp();
  const config = await writeResolverConfig(dir);
  await withEnvConfig(config, async () => {
    const args = { ...DEFAULT_BOOTSTRAP_ARGS, credentialSink: "sprinkleref" as const };
    const selection = await resolveCredentialSinkSelection(args);
    assert.equal(selection.kind, "sprinkleref");
    assert.equal(selection.backend, "local-file");
  });
});

test("--sprinkle-category selects access credential lifecycle category only", async () => {
  const dir = await tmp();
  const config = await writeResolverConfig(dir, "access-bootstrap");
  await withEnvConfig(config, async () => {
    const args = {
      ...DEFAULT_BOOTSTRAP_ARGS,
      mode: "deployment" as const,
      target: "//projects/deployments/sample-webapp/dev:deploy",
      credentialSink: "sprinkleref" as const,
      sprinkleCategory: "access-bootstrap",
    };
    const selection = await resolveCredentialSinkSelection(args);
    const dryRun = await buildDryRunReport(args);
    assert.equal(selection.category, "access-bootstrap");
    assert.equal(dryRun.credentialSink, "sprinkleref");
    const handoff = buildCredentialHandoffReport({
      args,
      sinkSelection: selection,
      sinkDescription: "SprinkleRef access-bootstrap local-file",
      bootstrapIdentity: { id: "identity", name: "iac-bootstrap" },
      metadata: {},
    });
    assert.equal(handoff.resolverHandoff.targetCategory, "access-bootstrap");
  });
});

test("--sprinkle-category rejects Infisical-backed access credential categories", async () => {
  const dir = await tmp();
  const config = path.join(dir, "sprinkleref.json");
  await fs.writeFile(
    config,
    JSON.stringify({
      version: 1,
      defaultCategory: "main",
      profiles: {
        "infisical-default": {
          backend: "infisical",
          host: "https://app.infisical.com",
          projectId: "project",
          defaultEnvironment: "staging",
          clientIdEnv: "INFISICAL_CLIENT_ID",
          clientSecretEnv: "INFISICAL_CLIENT_SECRET",
        },
      },
      categories: {
        main: { profile: "infisical-default" },
        access: {
          backend: "infisical",
          host: "https://app.infisical.com",
          projectId: "project",
          defaultEnvironment: "staging",
          clientIdEnv: "INFISICAL_CLIENT_ID",
          clientSecretEnv: "INFISICAL_CLIENT_SECRET",
        },
        bootstrap: { backend: "local-file", file: path.join(dir, "bootstrap.json") },
      },
    }),
  );
  await withEnvConfig(config, async () => {
    await assert.rejects(
      () =>
        resolveCredentialSinkSelection({
          ...DEFAULT_BOOTSTRAP_ARGS,
          credentialSink: "sprinkleref",
          sprinkleCategory: "main",
        }),
      /access credential sink category main must not use an Infisical profile/,
    );
    await assert.rejects(
      () =>
        resolveCredentialSinkSelection({
          ...DEFAULT_BOOTSTRAP_ARGS,
          credentialSink: "sprinkleref",
          sprinkleCategory: "access",
        }),
      /access credential sink category access must not use an Infisical backend/,
    );
  });
});

test("explicit macOS Keychain sink is not overridden by SprinkleRef config", async () => {
  const dir = await tmp();
  const config = await writeResolverConfig(dir);
  await withEnvConfig(config, async () => {
    const args = { ...DEFAULT_BOOTSTRAP_ARGS, credentialSink: "macos-keychain" as const };
    const selection = await resolveCredentialSinkSelection(args, { platform: "darwin" });
    assert.equal(selection.kind, "macos-keychain");
    assert.equal(selection.backend, "macos-keychain");
  });
});

test("explicit macOS Keychain sink fails with remediation off macOS", async () => {
  await assert.rejects(
    () =>
      resolveCredentialSinkSelection(
        { ...DEFAULT_BOOTSTRAP_ARGS, credentialSink: "macos-keychain" },
        { platform: "linux" },
      ),
    /requires macOS.*--credential-sink local-file.*SPRINKLEREF_CONFIG/s,
  );
});

test("auto sink reports SprinkleRef semantics when config is present", async () => {
  const dir = await tmp();
  const config = await writeResolverConfig(dir);
  await withEnvConfig(config, async () => {
    const args = { ...DEFAULT_BOOTSTRAP_ARGS, credentialSink: "auto" as const };
    const dryRun = await buildDryRunReport(args);
    assert.equal(dryRun.credentialSink, "sprinkleref");
    assert.equal(dryRun.credentialSinkBackend, "local-file");
    const handoff = buildCredentialHandoffReport({
      args,
      sinkSelection: await resolveCredentialSinkSelection(args),
      sinkDescription: "SprinkleRef bootstrap local-file",
      bootstrapIdentity: { id: "identity", name: "iac-bootstrap" },
      metadata: {},
    });
    assert.equal(handoff.sprinkleCategory, "bootstrap");
    assert.equal(handoff.credentialSink, "sprinkleref");
    assert.equal(handoff.credentialSinkBackend, "local-file");
    assert.equal(handoff.resolverHandoff.targetCategory, "bootstrap");
  });
});

async function tmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-backends-"));
}

async function writeResolverConfig(dir: string, bootstrapCategory = "bootstrap") {
  const config = path.join(dir, "sprinkleref.json");
  await fs.writeFile(
    config,
    JSON.stringify({
      version: 1,
      defaultCategory: "main",
      categories: {
        main: { backend: "local-file", file: path.join(dir, "main.json") },
        bootstrap: { backend: "local-file", file: path.join(dir, "bootstrap.json") },
        [bootstrapCategory]: {
          backend: "local-file",
          file: path.join(dir, `${bootstrapCategory}.json`),
        },
      },
    }),
  );
  return config;
}

async function withEnvConfig(config: string, run: () => Promise<void>) {
  const old = process.env.SPRINKLEREF_CONFIG;
  process.env.SPRINKLEREF_CONFIG = config;
  try {
    await run();
  } finally {
    if (old === undefined) delete process.env.SPRINKLEREF_CONFIG;
    else process.env.SPRINKLEREF_CONFIG = old;
  }
}

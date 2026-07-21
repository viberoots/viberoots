#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { ensureRepoResolverConfig } from "../../deployments/infisical-iac-bootstrap-resolver";
import {
  sharedConfigPath,
  tmp,
  withCwdAndEnv,
  writeBootstrapKeychainConfig,
  writeJson,
  writeRuntimeHostKeychainConfig,
} from "./infisical-iac-bootstrap.resolver-profiles.fixture";

test("repo bootstrap repairs legacy bootstrap Keychain service to repo default", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    await writeBootstrapKeychainConfig("viberoots-bootstrap");
    await ensureRepoResolverConfig({
      dryRun: false,
      workspaceRoot: dir,
      configPath: sharedConfigPath(),
    });
    const shared = JSON.parse(await fs.readFile(sharedConfigPath(), "utf8"));
    assert.equal(
      shared.sprinkleref.categories.bootstrap.service,
      `${path.basename(dir)}-bootstrap`,
    );
  });
});

test("repo bootstrap repairs legacy runtime host Keychain service to repo default", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    process.env.VBR_RUNTIME_HOST = "local-macos";
    await writeRuntimeHostKeychainConfig("viberoots-bootstrap");
    await writeJson("projects/config/local.json", {
      activeRuntimeHost: "local-macos",
    });
    await ensureRepoResolverConfig({
      dryRun: false,
      workspaceRoot: dir,
      configPath: sharedConfigPath(),
    });
    const shared = JSON.parse(await fs.readFile(sharedConfigPath(), "utf8"));
    assert.equal(shared.runtimeHosts["local-macos"].service, `${path.basename(dir)}-bootstrap`);
  });
});

test("repo bootstrap preserves custom bootstrap Keychain service", async () => {
  const dir = await tmp();
  await withCwdAndEnv(dir, async () => {
    await writeBootstrapKeychainConfig("custom-bootstrap-service");
    await ensureRepoResolverConfig({
      dryRun: false,
      workspaceRoot: dir,
      configPath: sharedConfigPath(),
    });
    const shared = JSON.parse(await fs.readFile(sharedConfigPath(), "utf8"));
    assert.equal(shared.sprinkleref.categories.bootstrap.service, "custom-bootstrap-service");
  });
});

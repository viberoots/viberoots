#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { $ } from "zx";
import {
  exactPermission,
  mainCapability,
  popupCapability,
  rejectedCapabilityMappings,
  rejectedPermissionMappings,
  rejectedPolicies,
} from "./rust.tauri-policy.cases";
import {
  config,
  policyScript,
  reviewedCsp,
  runScopedPolicy,
  sourceRoot,
} from "./rust.tauri-policy.fixture";
test("Tauri prebuild policy accepts only reviewed offline desktop authority", async () => {
  const root = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "tauri-policy-"));
  try {
    await Promise.all([
      fsp.mkdir(path.join(root, "frontend"), { recursive: true }),
      fsp.mkdir(path.join(root, "capabilities"), { recursive: true }),
      fsp.mkdir(path.join(root, "icons"), { recursive: true }),
    ]);
    await Promise.all([
      fsp.writeFile(path.join(root, "frontend/index.html"), "<main>ok</main>"),
      fsp.writeFile(path.join(root, "help.txt"), "help\n"),
      fsp.writeFile(path.join(root, "icons/icon.png"), "icon\n"),
      fsp.writeFile(path.join(root, "Cargo.toml"), '[package]\nname="desktop"\nversion="0.1.0"\n'),
      fsp.writeFile(path.join(root, "Cargo.lock"), "version = 3\n"),
    ]);
    const script = await policyScript(root);
    const run = async (
      value: Record<string, unknown>,
      capability: Record<string, unknown> = {
        identifier: "default",
        permissions: ["core:default"],
        windows: ["main"],
      },
      cargoLock = "version = 3\n",
    ) => {
      await Promise.all([
        fsp.writeFile(path.join(root, "tauri.conf.json"), JSON.stringify(value)),
        fsp.writeFile(path.join(root, "capabilities/default.json"), JSON.stringify(capability)),
        fsp.writeFile(path.join(root, "Cargo.lock"), cargoLock),
      ]);
      return $({ cwd: root, reject: false, nothrow: true, stdio: "pipe" })`bash -c ${script}`;
    };
    const scaffoldTemplate = await fsp.readFile(
      path.join(
        sourceRoot,
        "build-tools/tools/scaffolding/templates/rust/tauri-app/tauri.conf.json.jinja",
      ),
      "utf8",
    );
    const renderedScaffold = JSON.parse(
      scaffoldTemplate
        .replaceAll("{{ name }}", "desktop")
        .replaceAll("{{ tauri_identifier }}", "dev.viberoots.desktop"),
    ) as Record<string, unknown>;

    assert.equal((await run(config())).exitCode, 0);
    assert.equal((await run(renderedScaffold)).exitCode, 0);
    assert.equal(await runScopedPolicy(root), 0);
    await assert.rejects(
      policyScript(root, { appCommands: ["status; false #"] }),
      /conservative Rust\/Tauri command identifiers/,
    );
    assert.equal((await run(config())).exitCode, 0);
    assert.notEqual(
      (
        await $({
          cwd: root,
          env: { ...process.env, APPLE_SIGNING_IDENTITY: "-" },
          reject: false,
          nothrow: true,
          stdio: "pipe",
        })`bash -c ${script}`
      ).exitCode,
      0,
      "ambient ad-hoc signing identity",
    );
    assert.notEqual(
      (
        await $({
          cwd: root,
          env: { ...process.env, APPLE_CERTIFICATE: "credential" },
          reject: false,
          nothrow: true,
          stdio: "pipe",
        })`bash -c ${script}`
      ).exitCode,
      0,
      "ambient signing credential",
    );
    for (const [name, value, capability, lock] of rejectedPolicies) {
      assert.notEqual((await run(value, capability, lock)).exitCode, 0, name);
    }

    const mappedScript = await policyScript(root, {
      appCommands: ["report_status"],
      appWindows: ["main", "auth-popup"],
      capabilityFiles: ["capabilities/main.json", "capabilities/auth-popup.json"],
      permissionFiles: ["permissions/report.toml"],
    });
    const runMapped = async (main: Record<string, unknown>, authPopup: Record<string, unknown>) => {
      await Promise.all([
        fsp.writeFile(
          path.join(root, "tauri.conf.json"),
          JSON.stringify(
            config({
              app: {
                withGlobalTauri: false,
                security: { csp: reviewedCsp, capabilities: ["main", "auth-popup"] },
                windows: [{ label: "main" }, { label: "auth-popup" }],
              },
            }),
          ),
        ),
        fsp.writeFile(path.join(root, "capabilities/main.json"), JSON.stringify(main)),
        fsp.writeFile(path.join(root, "capabilities/auth-popup.json"), JSON.stringify(authPopup)),
        fsp.writeFile(path.join(root, "Cargo.lock"), "version = 3\n"),
      ]);
      return $({
        cwd: root,
        reject: false,
        nothrow: true,
        stdio: "pipe",
      })`bash -c ${mappedScript}`;
    };
    await fsp.writeFile(path.join(root, "permissions/report.toml"), exactPermission);
    assert.equal((await runMapped(mainCapability, popupCapability)).exitCode, 0);
    for (const [name, permission] of rejectedPermissionMappings) {
      await fsp.writeFile(path.join(root, "permissions/report.toml"), permission);
      assert.notEqual((await runMapped(mainCapability, popupCapability)).exitCode, 0, name);
    }
    await fsp.writeFile(path.join(root, "permissions/report.toml"), exactPermission);
    for (const [name, main, popup] of rejectedCapabilityMappings) {
      assert.notEqual((await runMapped(main, popup)).exitCode, 0, name);
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

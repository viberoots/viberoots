#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

const load = [
  'load("@prelude//:rules.bzl", "filegroup")',
  'load("@viberoots//build-tools/rust:defs.bzl", "tauri_ios_app", "tauri_mobile_suite")',
].join("\n");

async function writeApp(app: string): Promise<void> {
  for (const dir of ["src", "icons", "capabilities", "permissions", "mobile", "gen/mobile/ios"]) {
    await fsp.mkdir(path.join(app, dir), { recursive: true });
  }
  await fsp.writeFile(path.join(app, "src/main.rs"), "fn main() {}\n");
  await fsp.writeFile(path.join(app, "Cargo.toml"), '[package]\nname="app"\nversion="0.1.0"\n');
  await fsp.writeFile(path.join(app, "Cargo.lock"), "version = 3\n");
  await fsp.writeFile(path.join(app, "tauri.conf.json"), "{}\n");
  await fsp.writeFile(path.join(app, "help.txt"), "help\n");
  await fsp.writeFile(path.join(app, "icons/icon.png"), "icon\n");
  await fsp.writeFile(path.join(app, "capabilities/default.json"), "{}\n");
  await fsp.writeFile(path.join(app, "permissions/default.json"), "{}\n");
  await fsp.writeFile(path.join(app, "mobile/ios.config.json"), "{}\n");
  await fsp.writeFile(path.join(app, "mobile/ios-override.json"), "{}\n");
  await fsp.writeFile(path.join(app, "gen/mobile/ios/project.marker"), "ios\n");
}

test("disabled mobile suite labels preserve shared defaults and platform overrides", async () => {
  await runInTemp("tauri-suite-shared-contract", async (tmp, $) => {
    const app = path.join(tmp, "projects/apps/mobile");
    await writeApp(app);
    await fsp.writeFile(
      path.join(app, "TARGETS"),
      `${load}
filegroup(name = "frontend", srcs = ["tauri.conf.json"], labels = ["lang:node", "kind:app", "webapp:static"])
filegroup(name = "frontend_desktop", srcs = ["tauri.conf.json"], labels = ["lang:node", "kind:app", "webapp:static"])
filegroup(name = "frontend_android", srcs = ["tauri.conf.json"], labels = ["lang:node", "kind:app", "webapp:static"])
tauri_mobile_suite(
    name = "app",
    frontend_dist = ":frontend",
    crate = "shared_crate",
    icons = ["icons/icon.png"],
    resources = [{"src": "help.txt", "dest": "help/help.txt"}],
    capabilities = ["capabilities/default.json"],
    permissions = ["permissions/default.json"],
    srcs = ["src/main.rs"],
    app_commands = ["open_window"],
    app_windows = ["main"],
    ios_config = "mobile/ios.config.json",
    ios_project_srcs = ["gen/mobile/ios/project.marker"],
    desktop_overrides = {"frontend_dist": ":frontend_desktop"},
    ios_overrides = {"ios_bundle_identifier": "dev.viberoots.ios", "ios_config": "mobile/ios-override.json"},
    android_overrides = {"frontend_dist": ":frontend_android", "android_package": "dev.viberoots.android", "android_min_sdk": 26},
)
`,
    );
    const result = await $({ cwd: tmp, stdio: "pipe" })`
      buck2 uquery --json --output-attribute crate --output-attribute frontend_dist \
        --output-attribute icons --output-attribute capabilities --output-attribute permissions \
        --output-attribute resources --output-attribute resource_sources --output-attribute app_commands \
        --output-attribute app_windows --output-attribute srcs --output-attribute ios_config \
        --output-attribute ios_bundle_identifier --output-attribute android_package \
        --output-attribute android_min_sdk \
        "set(//projects/apps/mobile:app_desktop //projects/apps/mobile:app_ios //projects/apps/mobile:app_android)"
    `;
    const payload = JSON.parse(String(result.stdout || "{}"));
    const desktop = payload["root//projects/apps/mobile:app_desktop"];
    const ios = payload["root//projects/apps/mobile:app_ios"];
    const android = payload["root//projects/apps/mobile:app_android"];
    for (const node of [ios, android]) {
      assert.equal(node.crate, "shared_crate");
      assert.deepEqual(node.app_commands, ["open_window"]);
      assert.deepEqual(node.app_windows, ["main"]);
      assert.match(JSON.stringify(node), /icons\/icon\.png/);
      assert.match(JSON.stringify(node), /capabilities\/default\.json/);
      assert.match(JSON.stringify(node), /permissions\/default\.json/);
      assert.match(JSON.stringify(node), /src\/main\.rs/);
      assert.match(JSON.stringify(node), /help\.txt/);
    }
    assert.match(JSON.stringify(desktop.frontend_dist), /frontend_desktop/);
    assert.match(JSON.stringify(ios.frontend_dist), /:frontend|frontend"/);
    assert.match(JSON.stringify(android.frontend_dist), /frontend_android/);
    assert.match(JSON.stringify(ios.ios_config), /mobile\/ios-override\.json/);
    assert.equal(ios.ios_bundle_identifier, "dev.viberoots.ios");
    assert.equal(android.android_package, "dev.viberoots.android");
    assert.equal(android.android_min_sdk, 26);
  });
});

test("disabled mobile helpers validate and record direct mobile kwargs", async () => {
  await runInTemp("tauri-disabled-mobile-direct-contract", async (tmp, $) => {
    const app = path.join(tmp, "projects/apps/mobile");
    await writeApp(app);
    const base =
      `${load}\nfilegroup(name = "frontend", srcs = ["tauri.conf.json"], labels = ["lang:node", "kind:app", "webapp:static"])\n` +
      'tauri_ios_app(name = "app", frontend_dist = ":frontend", icons = ["icons/icon.png"], srcs = ["src/main.rs"], ios_config = "mobile/ios.config.json", ios_bundle_identifier = "dev.viberoots.direct")\n';
    await fsp.writeFile(path.join(app, "TARGETS"), base);
    const ok = await $({ cwd: tmp, stdio: "pipe" })`
      buck2 uquery --json --output-attribute ios_config --output-attribute ios_bundle_identifier //projects/apps/mobile:app
    `;
    assert.match(String(ok.stdout), /mobile\/ios\.config\.json/);
    assert.match(String(ok.stdout), /dev\.viberoots\.direct/);
    for (const [index, [snippet, expected]] of [
      ['ios_config = "../outside.json"', /ios_config must remain package-relative/],
      [
        'ios_project_srcs = ["gen/mobile/ios/**"]',
        /ios_project_srcs does not accept wildcard paths/,
      ],
      ['ios_bundle_identifier = "not valid"', /reverse-DNS identifier/],
      ['ios_signing_secret = ":secret"', /unknown arguments: ios_signing_secret/],
      [
        'resources = [{"src": "help.txt", "dest": "help/help.txt"}, {"src": "help.txt", "dest": "help/help.txt"}]',
        /resources destinations must be unique/,
      ],
      ['capabilities = ["capabilities/*.json"]', /capabilities does not accept wildcard paths/],
      ['tauri_artifact_kind = "macos-app"', /artifact kind macos-app is unsupported for ios/],
      ['tauri_signing_mode = "adhoc-platform"', /unsupported signing mode/],
      ['tauri_deployment_eligibility = "future-store"', /deployment eligibility/],
      [
        'tauri_artifact_kind = "ios-signed-ipa", tauri_signing_mode = "unsigned-local"',
        /signed mobile artifacts require release-signed/,
      ],
      [
        'tauri_deployment_eligibility = "release-admitted", tauri_signing_mode = "unsigned-local"',
        /only release-signed artifacts may be deployment eligible/,
      ],
      ['plugins = {"shell": {}}', /unreviewed plugin declarations/],
      ['plugin_deps = ["tauri-plugin-shell"]', /unreviewed plugin declarations/],
      ['plugin_permissions = ["shell:allow-execute"]', /unreviewed plugin declarations/],
    ].entries()) {
      const badApp = path.join(tmp, `projects/apps/mobile_bad_${index}`);
      await writeApp(badApp);
      await fsp.writeFile(
        path.join(badApp, "TARGETS"),
        `${load}\nfilegroup(name = "frontend", srcs = ["tauri.conf.json"], labels = ["lang:node", "kind:app", "webapp:static"])\ntauri_ios_app(name = "bad", frontend_dist = ":frontend", icons = ["icons/icon.png"], srcs = ["src/main.rs"], ${snippet})\n`,
      );
      const result = await $({ cwd: tmp, stdio: "pipe", reject: false, nothrow: true })`
        buck2 cquery --target-platforms //:no_cgo //projects/apps/mobile_bad_${index}:bad
      `;
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr || result.stdout), expected);
    }
  });
});

test("disabled mobile suite validates rejected shared public attrs", async () => {
  await runInTemp("tauri-suite-rejected-shared-contract", async (tmp, $) => {
    for (const [index, [snippet, expected]] of [
      [
        'resources = [{"src": "help.txt", "dest": "help/help.txt"}, {"src": "help.txt", "dest": "help/help.txt"}]',
        /resources destinations must be unique/,
      ],
      ['capabilities = ["capabilities/*.json"]', /capabilities does not accept wildcard paths/],
      ['plugins = {"shell": {}}', /unreviewed plugin declarations/],
      ['plugin_deps = ["tauri-plugin-shell"]', /unreviewed plugin declarations/],
      ['plugin_permissions = ["shell:allow-execute"]', /unreviewed plugin declarations/],
    ].entries()) {
      const app = path.join(tmp, `projects/apps/mobile_suite_bad_${index}`);
      await writeApp(app);
      await fsp.writeFile(
        path.join(app, "TARGETS"),
        `${load}\nfilegroup(name = "frontend", srcs = ["tauri.conf.json"], labels = ["lang:node", "kind:app", "webapp:static"])\ntauri_mobile_suite(name = "bad", frontend_dist = ":frontend", icons = ["icons/icon.png"], srcs = ["src/main.rs"], ${snippet})\n`,
      );
      const result = await $({ cwd: tmp, stdio: "pipe", reject: false, nothrow: true })`
        buck2 cquery --target-platforms //:no_cgo //projects/apps/mobile_suite_bad_${index}:bad_ios
      `;
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr || result.stdout), expected);
    }
  });
});

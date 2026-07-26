#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveNixCacheRoleProvenance } from "../../lib/nix-cache-role-provenance";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

test("cache role provenance survives flattened effective config", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nix-cache-role-provenance-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, "nix.conf"),
    ["include required.conf", "extra-substituters = https://optional.example/cache", ""].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "required.conf"),
    "substituters = https://required.example/cache\n",
  );
  const roles = resolveNixCacheRoleProvenance({
    env: {
      NIX_CONF_DIR: root,
      NIX_USER_CONF_FILES: "",
    },
    defaultSubstituters: ["https://default.example/cache"],
    effectiveSubstituters: ["https://required.example/cache", "https://optional.example/cache"],
  });
  assert.deepEqual(roles, {
    required: ["https://required.example/cache"],
    optional: ["https://optional.example/cache"],
  });
});

test("cache role provenance rejects config/effective-byte divergence", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nix-cache-role-mismatch-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, "nix.conf"),
    "extra-substituters = https://optional.example/cache\n",
  );
  assert.equal(
    resolveNixCacheRoleProvenance({
      env: { NIX_CONF_DIR: root, NIX_USER_CONF_FILES: "" },
      defaultSubstituters: ["https://required.example/cache"],
      effectiveSubstituters: ["https://required.example/cache"],
    }),
    undefined,
  );
});

test("later substituters assignment resets earlier optional provenance", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nix-cache-role-reset-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, "nix.conf"),
    [
      "extra-substituters = https://old-optional.example/cache",
      "substituters = https://required.example/cache",
      "",
    ].join("\n"),
  );
  assert.deepEqual(
    resolveNixCacheRoleProvenance({
      env: { NIX_CONF_DIR: root, NIX_USER_CONF_FILES: "" },
      defaultSubstituters: ["https://default.example/cache"],
      effectiveSubstituters: ["https://required.example/cache"],
    }),
    {
      required: ["https://required.example/cache"],
      optional: [],
    },
  );
});

test("provenance CLI owns no persistent compile-cache file", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nix-cache-role-cli-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const config = path.join(temp, "config");
  const nix = path.join(temp, "nix");
  const compileCache = path.join(temp, "node-compile-cache");
  fs.mkdirSync(config);
  fs.writeFileSync(
    path.join(config, "nix.conf"),
    "extra-substituters = https://optional.example/cache\n",
  );
  fs.writeFileSync(
    nix,
    [
      "#!/usr/bin/env bash",
      'printf \'%s\\n\' \'{"substituters":{"defaultValue":["https://required.example/cache"],"value":["https://required.example/cache","https://optional.example/cache"]}}\'',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      path.join(root, "build-tools/tools/dev/nix-cache-role-provenance.ts"),
      nix,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        NIX_CONF_DIR: config,
        NIX_USER_CONF_FILES: "",
        NODE_COMPILE_CACHE: compileCache,
        NODE_DISABLE_COMPILE_CACHE: "1",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(compileCache), false);
});

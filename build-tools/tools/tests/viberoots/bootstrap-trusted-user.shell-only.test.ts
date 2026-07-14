#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("bootstrap trust configuration is shell-only and idempotent", async () => {
  const bootstrap = await fsp.readFile(viberootsSourcePath("bootstrap"), "utf8");
  assert.doesNotMatch(bootstrap, /sudo\s+python(?:3)?\b/);
  const startMarker = 'sudo sh -s -- "${conf}" "${custom_conf}" "${user}" <<\'SH\'\n';
  const start = bootstrap.indexOf(startMarker);
  assert.notEqual(start, -1, "missing shell-only trusted-user operation");
  const bodyStart = start + startMarker.length;
  const end = bootstrap.indexOf("\nSH\n", bodyStart);
  assert.notEqual(end, -1, "unterminated trusted-user shell operation");
  const body = bootstrap.slice(bodyStart, end);

  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-bootstrap-trust-"));
  const conf = path.join(tmp, "nix.conf");
  const custom = path.join(tmp, "nix.custom.conf");
  try {
    await fsp.writeFile(conf, "experimental-features = nix-command\n", "utf8");
    await fsp.writeFile(custom, "extra-trusted-users = root alice\nkeep-outputs = true\n", "utf8");
    const run = async () => {
      const result = await $({
        stdio: "pipe",
        nothrow: true,
      })`sh -s -- ${conf} ${custom} bob <<< ${body}`;
      assert.equal(result.exitCode, 0, String(result.stderr || result.stdout));
    };
    await run();
    const once = {
      conf: await fsp.readFile(conf, "utf8"),
      custom: await fsp.readFile(custom, "utf8"),
    };
    assert.equal(once.conf, "experimental-features = nix-command\n\n!include nix.custom.conf\n");
    assert.equal(once.custom, "extra-trusted-users = root alice bob\nkeep-outputs = true\n");
    await run();
    assert.equal(await fsp.readFile(conf, "utf8"), once.conf);
    assert.equal(await fsp.readFile(custom, "utf8"), once.custom);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

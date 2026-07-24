#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import {
  accountWrapper,
  accountWrapperFixture,
  cleanupAccountFixture,
  createApiKeyAccount,
  installCodexScript,
} from "./codex-wrapper.accounts-test-fixture.ts";

test("upstream version detection warns and caches once per executable mtime", async () => {
  const fixture = await accountWrapperFixture();
  try {
    await createApiKeyAccount(fixture.home, "codex-account-a");
    await fsp.symlink("codex-account-a", `${fixture.home}/.codex-accounts/default`);
    await installCodexScript(
      fixture,
      `if [ "\${1:-}" = "--version" ]; then
  printf '%s\\n' 'codex-cli 9.0.0'
  exit 0
fi
`,
    );
    const env = { ...fixture.env, VBR_CODEX_VERSION_CHECK: "on" };
    const first = await $({
      cwd: fixture.gitRoot,
      stdio: "pipe",
      env,
      nothrow: true,
    })`${accountWrapper} exec first`;
    const second = await $({
      cwd: fixture.gitRoot,
      stdio: "pipe",
      env,
      nothrow: true,
    })`${accountWrapper} exec second`;
    const executable = path.join(fixture.bin, "codex");
    const changed = new Date(Date.now() + 5_000);
    await fsp.utimes(executable, changed, changed);
    const third = await $({
      cwd: fixture.gitRoot,
      stdio: "pipe",
      env,
      nothrow: true,
    })`${accountWrapper} exec after-mtime-change`;
    assert.equal(first.exitCode, 0, String(first.stderr));
    assert.equal(second.exitCode, 0, String(second.stderr));
    assert.equal(third.exitCode, 0, String(third.stderr));
    assert.match(String(first.stderr), /outside the reviewed 0\.144\.x range/);
    assert.doesNotMatch(String(second.stderr), /reviewed 0\.144\.x range/);
    assert.match(String(third.stderr), /outside the reviewed 0\.144\.x range/);
    const log = await fsp.readFile(fixture.log, "utf8");
    assert.equal((log.match(/^codex --version$/gm) || []).length, 2);
  } finally {
    await cleanupAccountFixture(fixture);
  }
});

test("a reviewed 0.144.x upstream version does not warn", async () => {
  const fixture = await accountWrapperFixture();
  try {
    await createApiKeyAccount(fixture.home, "codex-account-a");
    await fsp.symlink("codex-account-a", `${fixture.home}/.codex-accounts/default`);
    await installCodexScript(
      fixture,
      `if [ "\${1:-}" = "--version" ]; then
  printf '%s\\n' 'codex-cli 0.144.7'
  exit 0
fi
`,
    );
    const result = await $({
      cwd: fixture.gitRoot,
      stdio: "pipe",
      env: { ...fixture.env, VBR_CODEX_VERSION_CHECK: "on" },
      nothrow: true,
    })`${accountWrapper} exec compatible`;
    assert.equal(result.exitCode, 0, String(result.stderr));
    assert.doesNotMatch(String(result.stderr), /reviewed 0\.144\.x range/);
  } finally {
    await cleanupAccountFixture(fixture);
  }
});

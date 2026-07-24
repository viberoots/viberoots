#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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

async function waitForPath(file: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (
      await fsp
        .stat(file)
        .then(() => true)
        .catch(() => false)
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${file}`);
}

test("direct CLI and environment-selected login run once outside Safehouse", async () => {
  for (const selector of ["cli", "env"] as const) {
    const fixture = await accountWrapperFixture();
    try {
      await createApiKeyAccount(fixture.home, "codex-account-a");
      const env = {
        ...fixture.env,
        VBR_CODEX_SAFEHOUSE: "always",
        ...(selector === "env" ? { CODEX_ACCOUNT: "codex-account-a" } : {}),
      };
      const args = selector === "cli" ? ["--account", "codex-account-a", "login"] : ["login"];
      const result = await $({
        cwd: fixture.gitRoot,
        stdio: "pipe",
        env,
        nothrow: true,
      })`${accountWrapper} ${args}`;
      assert.equal(result.exitCode, 0, String(result.stderr));
      const log = await fsp.readFile(fixture.log, "utf8");
      assert.equal((log.match(/^codex login$/gm) || []).length, 1);
      assert.doesNotMatch(log, /^safehouse /m);
      assert.doesNotMatch(log, /--sandbox.*login/);
    } finally {
      await cleanupAccountFixture(fixture);
    }
  }
});

test("a concurrent second login fails on the canonical lock and cleanup releases it", async () => {
  const fixture = await accountWrapperFixture();
  try {
    const account = await createApiKeyAccount(fixture.home, "codex-account-a");
    const started = path.join(fixture.tmp, "login-started");
    const release = path.join(fixture.tmp, "login-release");
    await installCodexScript(
      fixture,
      `if [ "\${1:-}" = "login" ]; then
  : > ${JSON.stringify(started)}
  while [ ! -e ${JSON.stringify(release)} ]; do sleep 0.05; done
fi
`,
    );
    const env = { ...fixture.env };
    const first = spawn(accountWrapper, ["--account", "codex-account-a", "login"], {
      cwd: fixture.gitRoot,
      env,
      stdio: "ignore",
    });
    await waitForPath(path.join(account, ".login.lock"));
    const second = await $({
      cwd: fixture.gitRoot,
      stdio: "pipe",
      env,
      nothrow: true,
    })`${accountWrapper} --account codex-account-a login`;
    assert.equal(second.exitCode, 75);
    assert.match(String(second.stderr), /\.login\.lock/);
    await fsp.writeFile(release, "");
    const firstCode = await new Promise<number | null>((resolve) => first.once("exit", resolve));
    assert.equal(firstCode, 0);
    await assert.rejects(fsp.stat(path.join(account, ".login.lock")), /ENOENT/);
    const log = await fsp.readFile(fixture.log, "utf8");
    assert.equal((log.match(/^codex login$/gm) || []).length, 1);
  } finally {
    await cleanupAccountFixture(fixture);
  }
});

test("direct and guided login fail closed inside an already-active Safehouse", async () => {
  for (const guided of [false, true]) {
    const fixture = await accountWrapperFixture();
    try {
      if (!guided) await createApiKeyAccount(fixture.home, "codex-account-a");
      const args = guided
        ? ["--account", "codex-account-new", "--account-init", "exec", "after-login"]
        : ["--account", "codex-account-a", "login"];
      const result = await $({
        cwd: fixture.gitRoot,
        stdio: "pipe",
        env: {
          ...fixture.env,
          VBR_CODEX_SAFEHOUSE_ACTIVE: "1",
        },
        nothrow: true,
      })`${accountWrapper} ${args}`;
      assert.equal(result.exitCode, 77, String(result.stderr));
      assert.match(String(result.stderr), /inside an active Safehouse/);
      const log = await fsp.readFile(fixture.log, "utf8").catch(() => "");
      assert.doesNotMatch(log, /^codex login$/m);
    } finally {
      await cleanupAccountFixture(fixture);
    }
  }
});

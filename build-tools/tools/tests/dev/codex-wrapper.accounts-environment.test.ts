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

test("existing CODEX_ACCOUNT selects the same account path as --account", async () => {
  const fixture = await accountWrapperFixture();
  try {
    const account = await createApiKeyAccount(fixture.home, "codex-account-a");
    const result = await $({
      cwd: fixture.gitRoot,
      stdio: "pipe",
      env: { ...fixture.env, CODEX_ACCOUNT: "codex-account-a" },
      nothrow: true,
    })`${accountWrapper} exec env-selected`;
    assert.equal(result.exitCode, 0, String(result.stderr));
    const log = await fsp.readFile(fixture.log, "utf8");
    assert.match(log, new RegExp(`CODEX_HOME=${account}`));
  } finally {
    await cleanupAccountFixture(fixture);
  }
});

test("unknown CODEX_ACCOUNT fails closed without initialization intent", async () => {
  const fixture = await accountWrapperFixture();
  try {
    const result = await $({
      cwd: fixture.gitRoot,
      stdio: "pipe",
      env: { ...fixture.env, CODEX_ACCOUNT: "codex-account-new" },
      nothrow: true,
    })`${accountWrapper} exec env-selected`;
    assert.equal(result.exitCode, 66);
    assert.match(String(result.stderr), /does not exist/);
    await assert.rejects(fsp.stat(fixture.log), /ENOENT/);
  } finally {
    await cleanupAccountFixture(fixture);
  }
});

test("CODEX_ACCOUNT_INIT initializes an environment-selected account and reexecutes once", async () => {
  const fixture = await accountWrapperFixture();
  try {
    await installCodexScript(
      fixture,
      `if [ "\${1:-}" = "login" ]; then
  printf '%s' '{"auth_mode":"apikey","OPENAI_API_KEY":"sk-guided-test"}' > "$CODEX_HOME/auth.json"
fi
`,
    );
    const result = await $({
      cwd: fixture.gitRoot,
      stdio: "pipe",
      env: {
        ...fixture.env,
        CODEX_ACCOUNT: "codex-account-new",
        CODEX_ACCOUNT_INIT: "1",
      },
      nothrow: true,
    })`${accountWrapper} exec after-login`;
    assert.equal(result.exitCode, 0, String(result.stderr));
    const log = await fsp.readFile(fixture.log, "utf8");
    assert.equal((log.match(/^codex login$/gm) || []).length, 1);
    assert.equal(
      (log.match(/^codex --sandbox danger-full-access exec after-login$/gm) || []).length,
      1,
    );
    assert.equal(
      (
        log.match(
          new RegExp(
            `CODEX_HOME=${path.join(fixture.home, ".codex-accounts", "codex-account-new")}`,
            "g",
          ),
        ) || []
      ).length,
      4,
    );
  } finally {
    await cleanupAccountFixture(fixture);
  }
});

test("invalid and empty CODEX_ACCOUNT values fail closed with exit 2", async () => {
  for (const value of ["", "has/slash", "-leading"]) {
    const fixture = await accountWrapperFixture();
    try {
      const result = await $({
        cwd: fixture.gitRoot,
        stdio: "pipe",
        env: { ...fixture.env, CODEX_ACCOUNT: value },
        nothrow: true,
      })`${accountWrapper} exec invalid-env`;
      assert.equal(result.exitCode, 2, `value=${JSON.stringify(value)}`);
      assert.match(
        String(result.stderr),
        value === "" ? /CODEX_ACCOUNT is empty/ : /invalid account/,
      );
    } finally {
      await cleanupAccountFixture(fixture);
    }
  }
});

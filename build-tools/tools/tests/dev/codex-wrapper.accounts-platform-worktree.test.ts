#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { escapeRegExp, writeExecutable } from "./agent-wrapper-test-helpers.ts";
import {
  accountWrapper,
  accountWrapperFixture,
  cleanupAccountFixture,
  createApiKeyAccount,
} from "./codex-wrapper.accounts-test-fixture.ts";

test("Linux resolution rebinds CODEX_HOME without invoking Safehouse", async () => {
  const fixture = await accountWrapperFixture();
  try {
    const account = await createApiKeyAccount(fixture.home, "codex-account-a");
    await writeExecutable(
      path.join(fixture.bin, "uname"),
      "#!/usr/bin/env bash\nprintf 'Linux\\n'\n",
    );
    const result = await $({
      cwd: fixture.gitRoot,
      stdio: "pipe",
      env: {
        ...fixture.env,
        CODEX_ACCOUNT: "codex-account-a",
        VBR_CODEX_SAFEHOUSE: "always",
      },
      nothrow: true,
    })`${accountWrapper} exec linux`;
    assert.equal(result.exitCode, 0, String(result.stderr));
    const log = await fsp.readFile(fixture.log, "utf8");
    assert.doesNotMatch(log, /^safehouse /m);
    assert.match(log, new RegExp(`CODEX_HOME=${escapeRegExp(account)}`));
  } finally {
    await cleanupAccountFixture(fixture);
  }
});

test(
  "macOS Safehouse grants the selected account but not a sibling",
  { skip: process.platform !== "darwin" },
  async () => {
    const fixture = await accountWrapperFixture();
    try {
      const selected = await createApiKeyAccount(fixture.home, "codex-account-a");
      const sibling = await createApiKeyAccount(fixture.home, "codex-account-b");
      const result = await $({
        cwd: fixture.gitRoot,
        stdio: "pipe",
        env: {
          ...fixture.env,
          CODEX_ACCOUNT: "codex-account-a",
          VBR_CODEX_SAFEHOUSE: "always",
        },
        nothrow: true,
      })`${accountWrapper} exec macos`;
      assert.equal(result.exitCode, 0, String(result.stderr));
      const log = await fsp.readFile(fixture.log, "utf8");
      assert.match(log, new RegExp(`--add-dirs=${escapeRegExp(selected)}`));
      assert.match(
        log,
        new RegExp(`\\(deny file-read-data \\(literal "${escapeRegExp(fixture.home)}"\\)\\)`),
      );
      assert.doesNotMatch(log, new RegExp(`--add-dirs=${escapeRegExp(sibling)}`));
    } finally {
      await cleanupAccountFixture(fixture);
    }
  },
);

test("CLI account selector and initialization intent survive worktree reexec", async () => {
  const fixture = await accountWrapperFixture();
  try {
    const account = await createApiKeyAccount(fixture.home, "codex-account-a");
    const result = await $({
      cwd: fixture.gitRoot,
      stdio: "pipe",
      env: {
        ...fixture.env,
        VBR_CODEX_GIT_WRAPPER_FOR_TEST: path.join(fixture.bin, "git"),
      },
      nothrow: true,
    })`${accountWrapper} --account codex-account-a --account-init --worktree account-worker exec task`;
    assert.equal(result.exitCode, 0, String(result.stderr));
    const log = await fsp.readFile(fixture.log, "utf8");
    assert.match(log, /git worktree add/);
    assert.match(log, /codex --sandbox danger-full-access exec task/);
    assert.match(log, new RegExp(`CODEX_HOME=${escapeRegExp(account)}`));
    assert.doesNotMatch(log, /codex .*--account|codex .*--account-init/);
  } finally {
    await cleanupAccountFixture(fixture);
  }
});

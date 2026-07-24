#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { viberootsRoot, writeExecutable } from "./agent-wrapper-test-helpers.ts";
import {
  accountWrapper,
  accountWrapperFixture,
  cleanupAccountFixture,
  createApiKeyAccount,
  sanitizedAccountWrapperEnv,
} from "./codex-wrapper.accounts-test-fixture.ts";

test("account fixtures remove every inherited account and wrapper selector", () => {
  const poisoned = {
    CODEX_HOME: "/real/codex-home",
    CODEX_ACCOUNT: "real-account",
    CODEX_ACCOUNT_INIT: "1",
    CODEX_ACCOUNT_REMOVE_YES: "1",
    CODEX_CLI_PATH: "/real/codex",
    VBR_CODEX_SAFEHOUSE_ACTIVE: "1",
    VBR_CODEX_SAFEHOUSE_ROOT: "/real/repo",
    VBR_CODEX_FUTURE_SELECTOR: "poisoned",
  };
  const prior = new Map<string, string | undefined>();
  try {
    for (const [key, value] of Object.entries(poisoned)) {
      prior.set(key, process.env[key]);
      process.env[key] = value;
    }
    const env = sanitizedAccountWrapperEnv({ HOME: "/synthetic/home" });
    assert.equal(env.HOME, "/synthetic/home");
    for (const key of Object.keys(poisoned)) assert.equal(env[key], undefined, key);
  } finally {
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("a launched account helper crash maps to exit 70", async () => {
  const fixture = await accountWrapperFixture();
  try {
    await writeExecutable(path.join(fixture.bin, "zx-wrapper"), "#!/usr/bin/env bash\nexit 42\n");
    const result = await $({
      cwd: fixture.gitRoot,
      stdio: "pipe",
      env: {
        ...fixture.env,
        PATH: `${path.dirname(accountWrapper)}:${fixture.bin}:/usr/bin:/bin`,
      },
      nothrow: true,
    })`${accountWrapper} --list-accounts`;
    assert.equal(result.exitCode, 70);
    assert.match(String(result.stderr), /exited abnormally.*42/);
  } finally {
    await cleanupAccountFixture(fixture);
  }
});

test("interactive confirmations use the asynchronous controlling-terminal authority", async () => {
  const source = await fsp.readFile(
    path.join(viberootsRoot, "build-tools/tools/dev/codex-accounts/terminal.ts"),
    "utf8",
  );
  assert.match(source, /promptTerminalLine/);
  assert.match(source, /export async function confirm/);
  assert.doesNotMatch(source, /\breadSync\b/);
});

test("removal handles a legal account home path containing spaces, quotes, and a newline", async () => {
  const fixture = await accountWrapperFixture();
  try {
    const unusualHome = path.join(fixture.tmp, "home with 'quote'\nand newline");
    const account = await createApiKeyAccount(unusualHome, "codex-account-a");
    const result = await $({
      cwd: fixture.gitRoot,
      stdio: "pipe",
      env: { ...fixture.env, HOME: unusualHome },
      nothrow: true,
    })`${accountWrapper} --remove-account codex-account-a --yes`;
    assert.equal(result.exitCode, 0, String(result.stderr));
    await assert.rejects(fsp.stat(account), /ENOENT/);
  } finally {
    await cleanupAccountFixture(fixture);
  }
});

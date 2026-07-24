#!/usr/bin/env zx-wrapper
// Tests that wrapper-owned account flags are stripped from the argv seen by upstream codex,
// and that malformed forms fail closed per the design.
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { binWrapper, makeFakeAgentTools, scratchRoot } from "./agent-wrapper-test-helpers.ts";
import { sanitizedAccountWrapperEnv } from "./codex-wrapper.accounts-test-fixture.ts";

const wrapper = binWrapper("codex");

async function fixture(): Promise<{
  tmp: string;
  home: string;
  gitRoot: string;
  fake: { bin: string; log: string };
  env: NodeJS.ProcessEnv;
}> {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "codex-accts-argv-"));
  const gitRoot = path.join(tmp, "repo");
  const home = path.join(tmp, "home");
  await fsp.mkdir(gitRoot, { recursive: true });
  // Populate a default account so precedence resolves cleanly.
  const acct = path.join(home, ".codex-accounts", "codex-account-a");
  await fsp.mkdir(acct, { recursive: true });
  await fsp.writeFile(
    path.join(acct, "auth.json"),
    JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-test-only" }),
    "utf8",
  );
  await fsp.symlink("codex-account-a", path.join(home, ".codex-accounts", "default"));
  const fake = await makeFakeAgentTools(tmp, gitRoot, "codex");
  const env = sanitizedAccountWrapperEnv({
    HOME: home,
    CODEX_CLI_PATH: "",
    VBR_CODEX_MANAGED_PATH_FOR_TEST: path.join(fake.bin, "codex"),
    PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin:${process.env.PATH || ""}`,
    VBR_CODEX_SAFEHOUSE: "0",
    VBR_CODEX_NONINTERACTIVE: "1",
  });
  return { tmp, home, gitRoot, fake, env };
}

test("wrapper strips --account, --account=<v>, --account-init before invoking upstream", async () => {
  const { tmp, gitRoot, fake, env } = await fixture();
  try {
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env,
      nothrow: true,
    })`${wrapper} --account codex-account-a --account-init exec task`;
    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const log = await fsp.readFile(fake.log, "utf8");
    assert.doesNotMatch(log, /--account/);
    assert.doesNotMatch(log, /--account-init/);
    // Positional survives.
    assert.match(log, /exec task/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("wrapper preserves -p / -c / positionals and end-of-options --", async () => {
  const { tmp, gitRoot, fake, env } = await fixture();
  try {
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env,
      nothrow: true,
    })`${wrapper} --account codex-account-a -p debug -c foo=bar exec -- --account after-dash task`;
    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    const log = await fsp.readFile(fake.log, "utf8");
    // Wrapper flag stripped.
    assert.doesNotMatch(log, /^codex.*--account codex-account-a/m);
    // Upstream flags preserved.
    assert.match(log, /-p debug/);
    assert.match(log, /-c foo=bar/);
    // Everything after -- survives verbatim, including a literal --account token.
    assert.match(log, /-- --account after-dash task/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("--account with missing value fails closed with exit 2", async () => {
  const { tmp, gitRoot, env } = await fixture();
  try {
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env,
      nothrow: true,
    })`${wrapper} --account`;
    assert.equal(res.exitCode, 2);
    assert.match(String(res.stderr), /--account requires a name/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("--account= with empty value fails closed with exit 2", async () => {
  const { tmp, gitRoot, env } = await fixture();
  try {
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env,
      nothrow: true,
    })`${wrapper} --account= exec task`;
    assert.equal(res.exitCode, 2);
    assert.match(String(res.stderr), /--account requires a name/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("duplicate --account fails closed with exit 2", async () => {
  const { tmp, gitRoot, env } = await fixture();
  try {
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env,
      nothrow: true,
    })`${wrapper} --account codex-account-a --account codex-account-b exec task`;
    assert.equal(res.exitCode, 2);
    assert.match(String(res.stderr), /--account specified more than once/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("invalid account name (space) fails closed with exit 2", async () => {
  const { tmp, gitRoot, env } = await fixture();
  try {
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env,
      nothrow: true,
    })`${wrapper} --account ${"has space"} exec task`;
    assert.equal(res.exitCode, 2);
    assert.match(String(res.stderr), /invalid account name/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("reserved names 'default' and 'legacy' are rejected", async () => {
  const { tmp, gitRoot, env } = await fixture();
  try {
    for (const bad of ["default", "legacy"]) {
      const res = await $({
        cwd: gitRoot,
        stdio: "pipe",
        env,
        nothrow: true,
      })`${wrapper} --account ${bad} exec task`;
      assert.equal(res.exitCode, 2, `${bad} should be rejected`);
      assert.match(String(res.stderr), /invalid account name/);
    }
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

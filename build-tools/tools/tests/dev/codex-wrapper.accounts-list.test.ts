#!/usr/bin/env zx-wrapper
// Tests for `codex --list-accounts` and `codex --list-accounts=json`.
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { binWrapper, makeFakeAgentTools, scratchRoot } from "./agent-wrapper-test-helpers.ts";
import { sanitizedAccountWrapperEnv } from "./codex-wrapper.accounts-test-fixture.ts";

const wrapper = binWrapper("codex");

async function fixture(opts?: { withLegacy?: boolean }): Promise<{
  tmp: string;
  home: string;
  gitRoot: string;
  env: NodeJS.ProcessEnv;
}> {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "codex-accts-list-"));
  const gitRoot = path.join(tmp, "repo");
  const home = path.join(tmp, "home");
  await fsp.mkdir(gitRoot, { recursive: true });
  const acctRoot = path.join(home, ".codex-accounts");
  for (const name of ["codex-account-a", "codex-account-b"]) {
    const p = path.join(acctRoot, name);
    await fsp.mkdir(p, { recursive: true });
    await fsp.writeFile(
      path.join(p, "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-test-only" }),
    );
  }
  await fsp.symlink("codex-account-a", path.join(acctRoot, "default"));
  if (opts?.withLegacy) {
    await fsp.mkdir(path.join(home, ".codex"), { recursive: true });
    await fsp.writeFile(
      path.join(home, ".codex", "auth.json"),
      JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-test-only" }),
    );
  }
  const fake = await makeFakeAgentTools(tmp, gitRoot, "codex");
  const env = sanitizedAccountWrapperEnv({
    HOME: home,
    CODEX_CLI_PATH: "",
    VBR_CODEX_MANAGED_PATH_FOR_TEST: path.join(fake.bin, "codex"),
    PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin:${process.env.PATH || ""}`,
    VBR_CODEX_SAFEHOUSE: "0",
    VBR_CODEX_NONINTERACTIVE: "1",
  });
  return { tmp, home, gitRoot, env };
}

test("--list-accounts renders text with column header and default marker", async () => {
  const { tmp, gitRoot, env } = await fixture();
  try {
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env,
      nothrow: true,
    })`${wrapper} --list-accounts`;
    assert.equal(res.exitCode, 0);
    assert.match(String(res.stdout), /^NAME\s+AUTH\s+EMAIL\s+DEFAULT/m);
    assert.match(String(res.stdout), /codex-account-a\s+api-key\s+\(api key\)\s+\*/);
    assert.match(String(res.stdout), /codex-account-b\s+api-key\s+\(api key\)/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("--list-accounts=json emits schema-conformant JSON", async () => {
  const { tmp, gitRoot, env } = await fixture();
  try {
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env,
      nothrow: true,
    })`${wrapper} --list-accounts=json`;
    assert.equal(res.exitCode, 0);
    const rows = JSON.parse(String(res.stdout));
    const byName: Record<string, any> = {};
    for (const r of rows) byName[r.name] = r;
    assert.equal(byName["codex-account-a"].default, true);
    assert.equal(byName["codex-account-b"].default, false);
    assert.deepEqual(Object.keys(byName["codex-account-a"]).sort(), [
      "auth",
      "default",
      "email",
      "expired",
      "name",
    ]);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("legacy row appears when ~/.codex/ exists", async () => {
  const { tmp, gitRoot, env } = await fixture({ withLegacy: true });
  try {
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env,
      nothrow: true,
    })`${wrapper} --list-accounts=json`;
    assert.equal(res.exitCode, 0);
    const rows = JSON.parse(String(res.stdout));
    const legacy = rows.find((r: any) => r.name === "legacy");
    assert.ok(legacy, "legacy row must be present");
    assert.equal(legacy.default, false); // default resolves to codex-account-a
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("exit 69 when zx-wrapper is unavailable on PATH", async () => {
  const { tmp, gitRoot, env } = await fixture();
  try {
    // The wrapper's find_tool_excluding_wrapper_dir also consults captured_host_path(),
    // which walks up from $PWD looking for .viberoots/workspace/host-path. Plant an empty
    // marker inside tmp so the ancestor walk stops here with no fallback PATH.
    await fsp.mkdir(path.join(tmp, ".viberoots", "workspace"), { recursive: true });
    await fsp.writeFile(path.join(tmp, ".viberoots", "workspace", "host-path"), "");
    // Strip zx-wrapper from PATH by scoping to just the wrapper dir + /usr/bin.
    const strippedPath = `${path.dirname(wrapper)}:/usr/bin:/bin`;
    const res = await $({
      cwd: gitRoot,
      stdio: "pipe",
      env: { ...env, PATH: strippedPath, VBR_HOST_PATH: "", HOST_PATH: "" },
      nothrow: true,
    })`${wrapper} --list-accounts`;
    assert.equal(res.exitCode, 69);
    assert.match(String(res.stderr), /zx-wrapper/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

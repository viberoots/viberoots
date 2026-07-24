#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { makeJwt } from "./codex-accounts.fixture.ts";
import {
  accountWrapper,
  accountWrapperFixture,
  cleanupAccountFixture,
  createApiKeyAccount,
} from "./codex-wrapper.accounts-test-fixture.ts";

async function writeApiKeyAccount(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(
    path.join(dir, "auth.json"),
    JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-test-only" }),
  );
}

test("unsafe or stateless default targets fall through to legacy with an advisory", async () => {
  const cases = [
    { name: "dangling", target: "missing", setup: async () => {} },
    {
      name: "external",
      target: "EXTERNAL",
      setup: async (fixture: Awaited<ReturnType<typeof accountWrapperFixture>>) => {
        const external = path.join(fixture.tmp, "external-account");
        await writeApiKeyAccount(external);
        return external;
      },
    },
    {
      name: "escaping-account",
      target: "codex-account-escape",
      setup: async (fixture: Awaited<ReturnType<typeof accountWrapperFixture>>) => {
        const external = path.join(fixture.tmp, "external-via-account");
        const root = path.join(fixture.home, ".codex-accounts");
        await writeApiKeyAccount(external);
        await fsp.symlink(external, path.join(root, "codex-account-escape"));
      },
    },
    {
      name: "traversal",
      target: "../external-account",
      setup: async (fixture: Awaited<ReturnType<typeof accountWrapperFixture>>) => {
        await writeApiKeyAccount(path.join(fixture.home, "external-account"));
      },
    },
    {
      name: "invalid-name",
      target: "bad name",
      setup: async (fixture: Awaited<ReturnType<typeof accountWrapperFixture>>) => {
        await writeApiKeyAccount(path.join(fixture.home, ".codex-accounts", "bad name"));
      },
    },
    {
      name: "stateless",
      target: "codex-account-empty",
      setup: async (fixture: Awaited<ReturnType<typeof accountWrapperFixture>>) => {
        await fsp.mkdir(path.join(fixture.home, ".codex-accounts", "codex-account-empty"), {
          recursive: true,
        });
      },
    },
    {
      name: "corrupt-auth",
      target: "codex-account-corrupt",
      setup: async (fixture: Awaited<ReturnType<typeof accountWrapperFixture>>) => {
        const dir = path.join(fixture.home, ".codex-accounts", "codex-account-corrupt");
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(path.join(dir, "auth.json"), "{broken");
      },
    },
  ];

  for (const scenario of cases) {
    const fixture = await accountWrapperFixture();
    try {
      const root = path.join(fixture.home, ".codex-accounts");
      const legacy = path.join(fixture.home, ".codex");
      await writeApiKeyAccount(legacy);
      await fsp.mkdir(root, { recursive: true });
      const replacement = await scenario.setup(fixture);
      await fsp.symlink(replacement || scenario.target, path.join(root, "default"));
      const result = await $({
        cwd: fixture.gitRoot,
        stdio: "pipe",
        env: fixture.env,
        nothrow: true,
      })`${accountWrapper} exec ${scenario.name}`;
      assert.equal(result.exitCode, 0, `${scenario.name}: ${String(result.stderr)}`);
      assert.match(String(result.stderr), /falling through/);
      const log = await fsp.readFile(fixture.log, "utf8");
      assert.match(log, new RegExp(`CODEX_HOME=${legacy}`));
    } finally {
      await cleanupAccountFixture(fixture);
    }
  }
});

test("unknown-account initialization rejects an account root symlink", async () => {
  const fixture = await accountWrapperFixture();
  try {
    const root = path.join(fixture.home, ".codex-accounts");
    const external = path.join(fixture.tmp, "external-account-root");
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.mkdir(external, { recursive: true });
    await fsp.symlink(external, root);
    const result = await $({
      cwd: fixture.gitRoot,
      stdio: "pipe",
      env: fixture.env,
      nothrow: true,
    })`${accountWrapper} --account codex-account-new --account-init exec blocked`;
    assert.equal(result.exitCode, 2, String(result.stderr));
    assert.match(String(result.stderr), /account root must be a real directory/);
    await assert.rejects(fsp.stat(path.join(external, "codex-account-new")), /ENOENT/);
    const log = await fsp.readFile(fixture.log, "utf8").catch(() => "");
    assert.doesNotMatch(log, /^codex login$/m);
  } finally {
    await cleanupAccountFixture(fixture);
  }
});

test("listing omits invalid names and account symlinks that escape the account root", async () => {
  const fixture = await accountWrapperFixture();
  try {
    await createApiKeyAccount(fixture.home, "codex-account-valid");
    const root = path.join(fixture.home, ".codex-accounts");
    await writeApiKeyAccount(path.join(root, "bad name"));
    const external = path.join(fixture.tmp, "external");
    await writeApiKeyAccount(external);
    await fsp.symlink(external, path.join(root, "codex-account-escape"));
    const result = await $({
      cwd: fixture.gitRoot,
      stdio: "pipe",
      env: fixture.env,
      nothrow: true,
    })`${accountWrapper} --list-accounts=json`;
    assert.equal(result.exitCode, 0, String(result.stderr));
    const names = JSON.parse(String(result.stdout)).map((row: { name: string }) => row.name);
    assert.deepEqual(names, ["codex-account-valid"]);
  } finally {
    await cleanupAccountFixture(fixture);
  }
});

test("different usable ChatGPT identities in default and legacy state emit a warning", async () => {
  const fixture = await accountWrapperFixture();
  try {
    const root = path.join(fixture.home, ".codex-accounts");
    const selected = path.join(root, "codex-account-a");
    const legacy = path.join(fixture.home, ".codex");
    for (const [dir, email] of [
      [selected, "default@example.test"],
      [legacy, "legacy@example.test"],
    ]) {
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(
        path.join(dir, "auth.json"),
        JSON.stringify({
          auth_mode: "chatgpt",
          tokens: {
            id_token: makeJwt({ email, exp: 9_999_999_999, sub: "not-for-output" }),
            refresh_token: "refresh-test-only",
          },
        }),
      );
    }
    await fsp.symlink("codex-account-a", path.join(root, "default"));
    const result = await $({
      cwd: fixture.gitRoot,
      stdio: "pipe",
      env: fixture.env,
      nothrow: true,
    })`${accountWrapper} exec warning`;
    assert.equal(result.exitCode, 0, String(result.stderr));
    assert.match(String(result.stderr), /default@example\.test/);
    assert.match(String(result.stderr), /legacy@example\.test/);
    assert.doesNotMatch(String(result.stderr), /not-for-output|refresh-test-only/);
  } finally {
    await cleanupAccountFixture(fixture);
  }
});

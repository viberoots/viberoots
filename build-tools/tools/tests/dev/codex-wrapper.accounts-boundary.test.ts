#!/usr/bin/env zx-wrapper
// Repo-write boundary: the wrapper and helper must not leak the account name into any
// tracked path, nor any OPENAI_API_KEY / tokens.* value into any stream.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { makeJwt } from "./codex-accounts.fixture.ts";
import {
  binWrapper,
  makeFakeAgentTools,
  repoRoot,
  scratchRoot,
} from "./agent-wrapper-test-helpers.ts";
import { sanitizedAccountWrapperEnv } from "./codex-wrapper.accounts-test-fixture.ts";

const wrapper = binWrapper("codex");

const PROBE = ["zzz", "boundary", "probe"].join("-");
const API_SECRET = ["sk", "BOUNDARY", "SECRET"].join("-");
const ACCESS_TOKEN = ["access", "BOUNDARY", "TOKEN"].join("-");
const REFRESH_TOKEN = ["refresh", "BOUNDARY", "TOKEN"].join("-");
const PRIVATE_CLAIM = ["private", "BOUNDARY", "CLAIM"].join("-");
const EXCLUDED_ROOTS = new Set([
  ".git",
  ".viberoots",
  "buck-out",
  "coverage",
  "node_modules",
  ".direnv",
  ".codex-logs",
]);

async function sourceSnapshot(): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  async function walk(dir: string, relative: string): Promise<void> {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (EXCLUDED_ROOTS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (entry.isSymbolicLink()) {
        snapshot.set(rel, `link:${await fsp.readlink(full)}`);
      } else if (entry.isFile()) {
        const content = await fsp.readFile(full);
        snapshot.set(rel, crypto.createHash("sha256").update(content).digest("hex"));
      }
    }
  }
  await walk(repoRoot, "");
  return snapshot;
}

async function generatedResidue(
  since: number,
  excludedRoot: string,
  needles: string[],
): Promise<string[]> {
  const hits: string[] = [];
  const excluded = path.resolve(excludedRoot);
  async function walk(dir: string): Promise<void> {
    if (path.resolve(dir) === excluded || path.resolve(dir).startsWith(`${excluded}${path.sep}`)) {
      return;
    }
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const stat = await fsp.stat(full).catch(() => null);
        if (!stat || stat.mtimeMs + 1_000 < since) continue;
        const content = await fsp.readFile(full).catch(() => null);
        if (!content) continue;
        for (const needle of needles) {
          if (content.includes(Buffer.from(needle))) hits.push(`${full}: ${needle}`);
        }
      }
    }
  }
  for (const root of [
    path.join(repoRoot, ".viberoots", "workspace"),
    path.join(repoRoot, "buck-out", "tmp"),
  ]) {
    await walk(root);
  }
  return hits;
}

async function withFixture(): Promise<{
  tmp: string;
  home: string;
  env: NodeJS.ProcessEnv;
  cleanup: () => Promise<void>;
}> {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "codex-accts-boundary-"));
  const gitRoot = path.join(tmp, "repo");
  const home = path.join(tmp, "home");
  await fsp.mkdir(gitRoot, { recursive: true });
  const acctRoot = path.join(home, ".codex-accounts");
  const probeAcct = path.join(acctRoot, PROBE);
  await fsp.mkdir(probeAcct, { recursive: true });
  await fsp.writeFile(
    path.join(probeAcct, "auth.json"),
    JSON.stringify({
      auth_mode: "apikey",
      OPENAI_API_KEY: API_SECRET,
    }),
  );
  const chatgpt = path.join(acctRoot, "codex-account-chatgpt");
  await fsp.mkdir(chatgpt, { recursive: true });
  await fsp.writeFile(
    path.join(chatgpt, "auth.json"),
    JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        id_token: makeJwt({
          email: "fixture@example.test",
          exp: 9_999_999_999,
          sub: PRIVATE_CLAIM,
        }),
        access_token: ACCESS_TOKEN,
        refresh_token: REFRESH_TOKEN,
      },
    }),
  );
  await fsp.symlink(PROBE, path.join(acctRoot, "default"));
  const fake = await makeFakeAgentTools(tmp, gitRoot, "codex");
  const env = sanitizedAccountWrapperEnv({
    HOME: home,
    CODEX_CLI_PATH: "",
    VBR_CODEX_MANAGED_PATH_FOR_TEST: path.join(fake.bin, "codex"),
    PATH: `${path.dirname(wrapper)}:${fake.bin}:/usr/bin:/bin:${process.env.PATH || ""}`,
    VBR_CODEX_SAFEHOUSE: "0",
    VBR_CODEX_NONINTERACTIVE: "1",
  });
  return { tmp, home, env, cleanup: () => fsp.rm(tmp, { recursive: true, force: true }) };
}

test("account commands leave no source-tree residue and redact credentials", async () => {
  const { tmp, home, env, cleanup } = await withFixture();
  try {
    const before = await sourceSnapshot();
    const started = Date.now();
    const r1 = await $({
      cwd: repoRoot,
      stdio: "pipe",
      env,
      nothrow: true,
    })`${wrapper} --account ${PROBE} exec ok`;
    assert.equal(r1.exitCode, 0, String(r1.stderr));
    assert.doesNotMatch(String(r1.stdout), new RegExp(API_SECRET));
    assert.doesNotMatch(String(r1.stderr), new RegExp(API_SECRET));

    const r2 = await $({
      cwd: repoRoot,
      stdio: "pipe",
      env,
      nothrow: true,
    })`${wrapper} --list-accounts`;
    assert.equal(r2.exitCode, 0);
    assert.doesNotMatch(String(r2.stdout), new RegExp(API_SECRET));
    assert.doesNotMatch(String(r2.stdout), /OPENAI_API_KEY/);

    const after = await sourceSnapshot();
    assert.deepEqual(after, before, "account commands created or changed source-tree residue");
    assert.deepEqual(
      await generatedResidue(started, tmp, [
        PROBE,
        API_SECRET,
        ACCESS_TOKEN,
        REFRESH_TOKEN,
        PRIVATE_CLAIM,
      ]),
      [],
      "account commands leaked identity or credential values into generated/log/temp state",
    );

    // Verify no residue under HOME either.
    const homeContents = await $({
      cwd: home,
      stdio: "pipe",
      nothrow: true,
    })`grep -R ${API_SECRET} . 2>/dev/null || true`;
    // The secret only lives inside the acct's auth.json we planted; no other file should contain it.
    const bad = String(homeContents.stdout || "")
      .split("\n")
      .filter((l) => l && !l.includes("/auth.json"));
    assert.deepEqual(bad, []);
  } finally {
    await cleanup();
  }
});

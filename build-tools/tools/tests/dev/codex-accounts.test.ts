#!/usr/bin/env zx-wrapper
// Unit tests for codex-accounts.ts `list` command.
// These tests exercise the helper binary directly; they do not touch the codex wrapper.
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { makeJwt, runHelper, scratch, writeAuth } from "./codex-accounts.fixture.ts";

test("list --format text renders padded columns with header", async () => {
  const tmp = await scratch();
  try {
    const root = path.join(tmp, "accounts");
    await writeAuth(path.join(root, "codex-account-a"), {
      auth_mode: "chatgpt",
      tokens: {
        id_token: makeJwt({ email: "a@example.com", exp: 9999999999 }),
        refresh_token: "refresh-test-only",
      },
    });
    await writeAuth(path.join(root, "codex-account-b"), {
      auth_mode: "apikey",
      OPENAI_API_KEY: "sk-test-only",
    });
    const { code, stdout } = await runHelper(["list", "--root", root, "--format", "text"]);
    assert.equal(code, 0);
    const lines = stdout.trimEnd().split("\n");
    assert.match(lines[0]!, /^NAME\s+AUTH\s+EMAIL\s+DEFAULT$/);
    assert.match(stdout, /codex-account-a\s+chatgpt\s+a@example\.com/);
    assert.match(stdout, /codex-account-b\s+api-key\s+\(api key\)/);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("list --format json emits schema-conformant array", async () => {
  const tmp = await scratch();
  try {
    const root = path.join(tmp, "accounts");
    await writeAuth(path.join(root, "codex-account-a"), {
      auth_mode: "chatgpt",
      tokens: {
        id_token: makeJwt({ email: "a@example.com", exp: 9999999999 }),
        refresh_token: "refresh-test-only",
      },
    });
    await writeAuth(path.join(root, "codex-account-b"), {
      auth_mode: "apikey",
      OPENAI_API_KEY: "sk-test-only",
    });
    await fsp.mkdir(path.join(root, "codex-account-c"), { recursive: true });
    const { code, stdout } = await runHelper(["list", "--root", root, "--format", "json"]);
    assert.equal(code, 0);
    const rows = JSON.parse(stdout);
    assert.equal(rows.length, 3);
    const byName: Record<string, any> = {};
    for (const r of rows) byName[r.name] = r;
    assert.deepEqual(Object.keys(byName["codex-account-a"]).sort(), [
      "auth",
      "default",
      "email",
      "expired",
      "name",
    ]);
    assert.equal(byName["codex-account-a"].auth, "chatgpt");
    assert.equal(byName["codex-account-b"].auth, "api-key");
    assert.equal(byName["codex-account-b"].email, null);
    assert.equal(byName["codex-account-c"].auth, null);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("list decodes base64url JWT payload with and without padding", async () => {
  const tmp = await scratch();
  try {
    const root = path.join(tmp, "accounts");
    await writeAuth(path.join(root, "codex-account-a"), {
      auth_mode: "chatgpt",
      tokens: {
        id_token: makeJwt({ email: "aa@bb.example", exp: 9999999999 }),
        access_token: "access-test-only",
      },
    });
    const { code, stdout } = await runHelper(["list", "--root", root, "--format", "json"]);
    assert.equal(code, 0);
    assert.equal(JSON.parse(stdout)[0].email, "aa@bb.example");
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("list degrades missing / empty / corrupt auth.json to not-logged-in", async () => {
  const tmp = await scratch();
  try {
    const root = path.join(tmp, "accounts");
    await writeAuth(path.join(root, "codex-account-a"), null);
    await writeAuth(path.join(root, "codex-account-b"), "");
    await writeAuth(path.join(root, "codex-account-c"), "{ not json");
    await writeAuth(path.join(root, "codex-account-d"), {
      auth_mode: "chatgpt",
      tokens: { id_token: "not.a.valid.token" },
    });
    const { code, stdout } = await runHelper(["list", "--root", root, "--format", "text"]);
    assert.equal(code, 0);
    for (const name of [
      "codex-account-a",
      "codex-account-b",
      "codex-account-c",
      "codex-account-d",
    ]) {
      assert.match(stdout, new RegExp(name));
    }
    assert.ok(stdout.includes("not logged in"));
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("list resolves default symlink target via realpath for --current matching", async () => {
  const tmp = await scratch();
  try {
    const root = path.join(tmp, "accounts");
    await writeAuth(path.join(root, "codex-account-a"), {
      auth_mode: "apikey",
      OPENAI_API_KEY: "sk-test-only",
    });
    await writeAuth(path.join(root, "codex-account-b"), {
      auth_mode: "apikey",
      OPENAI_API_KEY: "sk-test-only",
    });
    await fsp.symlink("codex-account-a", path.join(root, "default"));
    const currentReal = await fsp.realpath(path.join(root, "default"));
    const { stdout } = await runHelper([
      "list",
      "--root",
      root,
      "--current",
      currentReal,
      "--format",
      "json",
    ]);
    const rows = JSON.parse(stdout);
    assert.equal(rows.find((r: any) => r.name === "codex-account-a").default, true);
    assert.equal(rows.find((r: any) => r.name === "codex-account-b").default, false);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("list includes legacy row labeled 'legacy'; DEFAULT marker only when --current matches", async () => {
  const tmp = await scratch();
  try {
    const root = path.join(tmp, "accounts");
    const legacy = path.join(tmp, "legacy-codex");
    await writeAuth(path.join(root, "codex-account-a"), {
      auth_mode: "apikey",
      OPENAI_API_KEY: "sk-test-only",
    });
    await writeAuth(legacy, {
      auth_mode: "apikey",
      OPENAI_API_KEY: "sk-test-only",
    });
    const noCurrent = await runHelper([
      "list",
      "--root",
      root,
      "--legacy-root",
      legacy,
      "--format",
      "json",
    ]);
    const rowsNo = JSON.parse(noCurrent.stdout);
    assert.ok(rowsNo.find((r: any) => r.name === "legacy"));
    assert.ok(!rowsNo.find((r: any) => r.default === true));
    const legacyReal = await fsp.realpath(legacy);
    const withCurrent = await runHelper([
      "list",
      "--root",
      root,
      "--legacy-root",
      legacy,
      "--current",
      legacyReal,
      "--format",
      "json",
    ]);
    const rowsWith = JSON.parse(withCurrent.stdout);
    assert.equal(rowsWith.find((r: any) => r.name === "legacy").default, true);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

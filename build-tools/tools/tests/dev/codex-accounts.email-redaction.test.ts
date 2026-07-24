#!/usr/bin/env zx-wrapper
// Unit tests for the codex-accounts.ts email subcommand and output redaction.
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { makeJwt, runHelper, scratch, writeAuth } from "./codex-accounts.fixture.ts";

test("email prints only the email; silent on any error", async () => {
  const tmp = await scratch();
  try {
    const good = path.join(tmp, "good");
    await writeAuth(good, {
      auth_mode: "chatgpt",
      tokens: {
        id_token: makeJwt({ email: "z@example.com", exp: 9999999999 }),
        refresh_token: "refresh-test-only",
      },
    });
    const okRes = await runHelper(["email", "--root", good]);
    assert.equal(okRes.code, 0);
    assert.equal(okRes.stdout, "z@example.com");

    const badRes = await runHelper(["email", "--root", path.join(tmp, "missing")]);
    assert.equal(badRes.code, 0);
    assert.equal(badRes.stdout, "");
    assert.equal(badRes.stderr, "");

    const corrupt = path.join(tmp, "corrupt");
    await writeAuth(corrupt, "{ bad json");
    const corruptRes = await runHelper(["email", "--root", corrupt]);
    assert.equal(corruptRes.code, 0);
    assert.equal(corruptRes.stdout, "");
    assert.equal(corruptRes.stderr, "");
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("no OPENAI_API_KEY or tokens.* value leaks into any output", async () => {
  const tmp = await scratch();
  try {
    const root = path.join(tmp, "accounts");
    await writeAuth(path.join(root, "codex-account-a"), {
      auth_mode: "apikey",
      OPENAI_API_KEY: "sk-VERY-SECRET-KEY-VALUE",
    });
    await writeAuth(path.join(root, "codex-account-b"), {
      auth_mode: "chatgpt",
      tokens: {
        id_token: makeJwt({ email: "b@example.com", exp: 9999999999 }),
        access_token: "ACCESS-SHOULD-NEVER-APPEAR",
        refresh_token: "REFRESH-SHOULD-NEVER-APPEAR",
      },
    });
    for (const fmt of ["text", "json"]) {
      const res = await runHelper(["list", "--root", root, "--format", fmt]);
      assert.equal(res.code, 0);
      assert.doesNotMatch(res.stdout, /sk-VERY-SECRET/);
      assert.doesNotMatch(res.stdout, /ACCESS-SHOULD-NEVER-APPEAR/);
      assert.doesNotMatch(res.stdout, /REFRESH-SHOULD-NEVER-APPEAR/);
      assert.doesNotMatch(res.stderr, /sk-VERY-SECRET/);
      assert.doesNotMatch(res.stderr, /OPENAI_API_KEY/);
    }
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

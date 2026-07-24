#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { makeJwt, runHelper, scratch, writeAuth } from "./codex-accounts.fixture.ts";

test("only recognized, non-empty authentication records are usable", async () => {
  const tmp = await scratch();
  try {
    const root = path.join(tmp, "accounts");
    await writeAuth(path.join(root, "missing"), null);
    await writeAuth(path.join(root, "empty"), "");
    await writeAuth(path.join(root, "corrupt"), "{bad");
    await writeAuth(path.join(root, "api-key-empty"), { auth_mode: "apikey" });
    await writeAuth(path.join(root, "chatgpt-incomplete"), {
      auth_mode: "chatgpt",
      tokens: { id_token: makeJwt({ email: "incomplete@example.test" }) },
    });
    await writeAuth(path.join(root, "api-key-valid"), {
      auth_mode: "apikey",
      OPENAI_API_KEY: "sk-usable-test",
    });
    await writeAuth(path.join(root, "chatgpt-valid"), {
      auth_mode: "chatgpt",
      tokens: {
        id_token: makeJwt({
          email: "usable@example.test",
          exp: 9_999_999_999,
          sub: "private-subject",
          sid: "private-session",
        }),
        refresh_token: "private-refresh",
      },
    });

    const result = await runHelper(["list", "--root", root, "--format", "json"]);
    assert.equal(result.code, 0, result.stderr);
    const rows = new Map(
      JSON.parse(result.stdout).map((row: { name: string; auth: string | null }) => [
        row.name,
        row,
      ]),
    );
    for (const name of ["missing", "empty", "corrupt", "api-key-empty", "chatgpt-incomplete"]) {
      assert.equal((rows.get(name) as { auth: string | null }).auth, null, name);
    }
    assert.equal((rows.get("api-key-valid") as { auth: string }).auth, "api-key");
    assert.equal((rows.get("chatgpt-valid") as { auth: string }).auth, "chatgpt");
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /sk-usable|private-subject|private-session|private-refresh/,
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

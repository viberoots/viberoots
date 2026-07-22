import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { deletedOpenFileOwnerPids, openFileOwnerPids } from "../../lib/open-file-inspection";

async function fakeLsof(body: string): Promise<{ executable: string; root: string }> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "open-file-inspection-"));
  const executable = path.join(root, "lsof");
  await fsp.writeFile(executable, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return { root, executable };
}

test("open-file inspection resolves the reviewed tool and returns unique owner pids", async (t) => {
  const fixture = await fakeLsof("printf '123\\n123\\n456\\n'");
  t.after(async () => await fsp.rm(fixture.root, { recursive: true, force: true }));
  assert.deepEqual(
    await openFileOwnerPids("/nix/store/example", { executable: fixture.executable }),
    ["123", "456"],
  );
});

test("open-file inspection distinguishes no matches from inspection failure", async (t) => {
  const noMatches = await fakeLsof("exit 1");
  const failed = await fakeLsof("echo denied >&2; exit 1");
  const malformed = await fakeLsof("echo unknown");
  t.after(async () => await fsp.rm(noMatches.root, { recursive: true, force: true }));
  t.after(async () => await fsp.rm(failed.root, { recursive: true, force: true }));
  t.after(async () => await fsp.rm(malformed.root, { recursive: true, force: true }));
  assert.deepEqual(
    await openFileOwnerPids("/nix/store/example", { executable: noMatches.executable }),
    [],
  );
  await assert.rejects(
    openFileOwnerPids("/nix/store/example", { executable: failed.executable }),
    /inspection failed/,
  );
  await assert.rejects(
    openFileOwnerPids("/nix/store/example", { executable: malformed.executable }),
    /invalid output/,
  );
});

test("deleted-open inspection returns owners only for deleted files below the root", async (t) => {
  const fixture = await fakeLsof(
    "printf 'p123\\nn/nix/store/example/deleted\\np456\\nn/nix/store/other/deleted\\np123\\nn/nix/store/example/again\\n'",
  );
  t.after(async () => await fsp.rm(fixture.root, { recursive: true, force: true }));
  assert.deepEqual(
    await deletedOpenFileOwnerPids("/nix/store/example", { executable: fixture.executable }),
    ["123"],
  );
});

test("deleted-open inspection rejects command failure", async (t) => {
  const fixture = await fakeLsof("echo denied >&2; exit 1");
  t.after(async () => await fsp.rm(fixture.root, { recursive: true, force: true }));
  await assert.rejects(
    deletedOpenFileOwnerPids("/nix/store/example", { executable: fixture.executable }),
    /inspection failed/,
  );
});

test("deleted-open inspection treats exit one without diagnostics as no matches", async (t) => {
  const fixture = await fakeLsof("exit 1");
  t.after(async () => await fsp.rm(fixture.root, { recursive: true, force: true }));
  assert.deepEqual(
    await deletedOpenFileOwnerPids("/nix/store/example", { executable: fixture.executable }),
    [],
  );
});

test("open-file evidence tools receive only their declared environment", async (t) => {
  const fixture = await fakeLsof(
    'if [ -n "${HOSTILE_OPEN_FILE_VALUE:-}" ]; then echo ambient; else printf "321\\n"; fi',
  );
  t.after(async () => await fsp.rm(fixture.root, { recursive: true, force: true }));
  const prior = process.env.HOSTILE_OPEN_FILE_VALUE;
  process.env.HOSTILE_OPEN_FILE_VALUE = "ambient";
  try {
    assert.deepEqual(
      await openFileOwnerPids("/nix/store/example", {
        executable: fixture.executable,
        env: { PATH: "/nix/store/reviewed-tools/bin" },
      }),
      ["321"],
    );
  } finally {
    if (prior === undefined) delete process.env.HOSTILE_OPEN_FILE_VALUE;
    else process.env.HOSTILE_OPEN_FILE_VALUE = prior;
  }
});

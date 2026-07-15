import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openFileOwnerPids } from "../../lib/open-file-inspection";

async function fakeLsof(body: string): Promise<{ env: NodeJS.ProcessEnv; root: string }> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "open-file-inspection-"));
  const executable = path.join(root, "lsof");
  await fsp.writeFile(executable, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return { root, env: { ...process.env, PATH: root } };
}

test("open-file inspection resolves the reviewed tool and returns unique owner pids", async (t) => {
  const fixture = await fakeLsof("printf '123\\n123\\n456\\n'");
  t.after(async () => await fsp.rm(fixture.root, { recursive: true, force: true }));
  assert.deepEqual(await openFileOwnerPids("/nix/store/example", { env: fixture.env }), [
    "123",
    "456",
  ]);
});

test("open-file inspection distinguishes no matches from inspection failure", async (t) => {
  const noMatches = await fakeLsof("exit 1");
  const failed = await fakeLsof("echo denied >&2; exit 1");
  const malformed = await fakeLsof("echo unknown");
  t.after(async () => await fsp.rm(noMatches.root, { recursive: true, force: true }));
  t.after(async () => await fsp.rm(failed.root, { recursive: true, force: true }));
  t.after(async () => await fsp.rm(malformed.root, { recursive: true, force: true }));
  assert.deepEqual(await openFileOwnerPids("/nix/store/example", { env: noMatches.env }), []);
  await assert.rejects(
    openFileOwnerPids("/nix/store/example", { env: failed.env }),
    /inspection failed/,
  );
  await assert.rejects(
    openFileOwnerPids("/nix/store/example", { env: malformed.env }),
    /invalid output/,
  );
});

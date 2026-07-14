#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { UPDATE_COMMAND_HELP } from "../../dev/update-command/args";
import { VIBEROOTS_SOURCE_ROOT } from "../lib/test-helpers/source-paths";

const execFileAsync = promisify(execFile);

test("command docs and help agree on update authority", async () => {
  const root = VIBEROOTS_SOURCE_ROOT;
  const docs = [
    "README.md",
    "docs/handbook/getting-started-on-a-pr.md",
    "docs/viberoots-maintenance-commands.md",
    "docs/viberoots-source-modes.md",
  ];
  for (const rel of docs) {
    const text = await fsp.readFile(path.join(root, rel), "utf8");
    for (const command of ["`i`", "`u`", "`u --upgrade`", "`viberoots update`"]) {
      assert.ok(text.includes(command), `${rel} must document ${command}`);
    }
  }

  const { stdout: uHelp } = await execFileAsync(
    path.join(root, "build-tools", "tools", "bin", "u"),
    ["--help"],
    { cwd: root },
  );
  assert.match(uHelp, /u\s+conservatively repair|Make project dependency/);
  assert.match(uHelp, /u --upgrade only when dependency versions should move/);
  assert.match(uHelp, /viberoots update when the viberoots pin itself should move/);
  assert.match(UPDATE_COMMAND_HELP, /u\s+conservatively repair locks/);
  assert.match(UPDATE_COMMAND_HELP, /u --upgrade\s+intentionally upgrade pnpm/);
  assert.match(UPDATE_COMMAND_HELP, /viberoots update when the viberoots pin itself should move/);

  const { stdout: viberootsHelp } = await execFileAsync(
    path.join(root, "build-tools", "tools", "bin", "viberoots"),
    ["help", "update"],
    { cwd: root, env: { ...process.env, NO_DEV_SHELL: "1" } },
  );
  assert.match(viberootsHelp, /Update viberoots pins without upgrading project dependencies/);
  assert.match(viberootsHelp, /use u to repair project metadata/);
  assert.match(viberootsHelp, /u --upgrade to intentionally move dependency versions/);
});

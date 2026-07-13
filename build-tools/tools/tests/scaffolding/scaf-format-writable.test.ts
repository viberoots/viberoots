import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  ensureScaffoldTreeWritable,
  formatImporterLockfiles,
} from "../../scaffolding/scaf/commands/new-helpers";

test("ensureScaffoldTreeWritable restores owner write bits on copied template trees", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "scaf-tree-writable-"));
  const nestedDir = path.join(root, "projects", "apps", "demo", "server");
  const file = path.join(nestedDir, "index.ts");
  await fsp.mkdir(nestedDir, { recursive: true });
  await fsp.writeFile(file, "export {}\n", "utf8");
  await fsp.chmod(file, 0o444);
  await fsp.chmod(nestedDir, 0o555);

  try {
    await ensureScaffoldTreeWritable(root);

    const dirMode = (await fsp.stat(nestedDir)).mode;
    const fileMode = (await fsp.stat(file)).mode;
    assert.equal((dirMode & 0o200) !== 0, true);
    assert.equal((fileMode & 0o200) !== 0, true);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("formatImporterLockfiles makes copied lockfiles writable before prettier", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "scaf-format-writable-"));
  const importer = path.join("projects", "libs", "demo");
  const lockfile = path.join(root, importer, "pnpm-lock.yaml");
  const fakeBin = path.join(root, "node_modules", ".bin");
  const prettier = path.join(fakeBin, "prettier");
  await fsp.mkdir(path.dirname(lockfile), { recursive: true });
  await fsp.mkdir(fakeBin, { recursive: true });
  await fsp.writeFile(lockfile, "lockfileVersion: 9\n", "utf8");
  await fsp.chmod(lockfile, 0o444);
  await fsp.writeFile(
    prettier,
    [
      "#!/bin/sh",
      '[ "$1" = "--write" ] || exit 2',
      "shift",
      'for file in "$@"; do',
      "  printf '# formatted\\n' >> \"$file\" || exit 3",
      "done",
      "",
    ].join("\n"),
    "utf8",
  );
  await fsp.chmod(prettier, 0o755);

  await formatImporterLockfiles(root, [importer]);

  const formatted = await fsp.readFile(lockfile, "utf8");
  assert.match(formatted, /# formatted/);
  const mode = (await fsp.stat(lockfile)).mode;
  assert.equal((mode & 0o200) !== 0, true);
});

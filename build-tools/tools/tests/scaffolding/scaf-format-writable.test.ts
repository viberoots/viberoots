import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { formatImporterLockfiles } from "../../scaffolding/scaf/commands/new-helpers";

test("formatImporterLockfiles makes copied lockfiles writable before prettier", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "scaf-format-writable-"));
  const importer = path.join("projects", "libs", "demo");
  const lockfile = path.join(root, importer, "pnpm-lock.yaml");
  const fakeBin = path.join(root, ".fake-bin");
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

  const prevPath = process.env.PATH;
  try {
    process.env.PATH = fakeBin;
    await formatImporterLockfiles(root, [importer]);
  } finally {
    if (prevPath === undefined) delete process.env.PATH;
    else process.env.PATH = prevPath;
  }

  const formatted = await fsp.readFile(lockfile, "utf8");
  assert.match(formatted, /# formatted/);
  const mode = (await fsp.stat(lockfile)).mode;
  assert.equal((mode & 0o200) !== 0, true);
});

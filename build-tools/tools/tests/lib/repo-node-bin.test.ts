import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { requireRepoNodeBin, resolveRepoNodeBin } from "../../lib/repo-node-bin";

async function tempRoot(name: string): Promise<string> {
  return await fsp.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

test("resolveRepoNodeBin finds active viberoots node_modules binaries", async () => {
  const root = await tempRoot("repo-node-bin-active");
  const prettier = path.join(root, ".viberoots", "current", "node_modules", ".bin", "prettier");
  await fsp.mkdir(path.dirname(prettier), { recursive: true });
  await fsp.mkdir(path.join(root, ".viberoots", "current", "build-tools", "tools", "dev"), {
    recursive: true,
  });
  await fsp.writeFile(
    path.join(root, ".viberoots", "current", "build-tools", "tools", "dev", "zx-init.mjs"),
    "",
    "utf8",
  );
  await fsp.writeFile(prettier, "#!/usr/bin/env bash\n", "utf8");

  assert.equal(await resolveRepoNodeBin(root, "prettier", { PATH: "" }), prettier);
});

test("resolveRepoNodeBin finds devshell viberoots node binary path", async () => {
  const root = await tempRoot("repo-node-bin-env");
  const nodeBin = path.join(root, "managed-node-bin");
  const prettier = path.join(nodeBin, "prettier");
  await fsp.mkdir(nodeBin, { recursive: true });
  await fsp.writeFile(prettier, "#!/usr/bin/env bash\n", "utf8");

  assert.equal(
    await resolveRepoNodeBin(root, "prettier", {
      PATH: "",
      VIBEROOTS_NODE_BIN: nodeBin,
    }),
    prettier,
  );
});

test("requireRepoNodeBin explains missing managed formatter setup", async () => {
  const root = await tempRoot("repo-node-bin-missing");
  await assert.rejects(
    () => requireRepoNodeBin(root, "prettier", { commandName: "scaf new", env: { PATH: "" } }),
    (error) => {
      const message = String((error as Error).message || error);
      assert.match(message, /scaf new requires prettier/);
      assert.match(message, /checked:/);
      assert.match(message, /node_modules\/\.bin\/prettier/);
      assert.match(message, /run 'i' to provision repo dev tools/);
      assert.doesNotMatch(message, /spawn prettier ENOENT/);
      return true;
    },
  );
});

#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { $ } from "zx";
import { scanRepositoryRefs } from "../../deployments/sprinkleref-check-scan";

test("repo scanner ignores tool catalogs and explicitly ignored guidance strings", async () => {
  const dir = await gitRepo();
  await writeTracked(dir, "projects/deployments/app/TARGETS", [
    'secret_requirements = [{"contract_id": "secret://deployments/app/api_token"}]',
  ]);
  await writeTracked(
    dir,
    "build-tools/tools/deployments/catalog.ts",
    'const ref = "secret://deployments/catalog/not-active";\n',
  );
  await writeTracked(dir, "projects/deployments/app/opentofu/main.tf", [
    '"valid secret://deployments/app/from_tf"',
    "# sprinkleref: ignore-next-line",
    '"run sprinkleref add secret://deployments/app/manual_later"',
  ]);
  const scanned = await scanRepositoryRefs(dir);
  assert.deepEqual(
    scanned.refs.map((entry) => entry.ref),
    ["secret://deployments/app/api_token", "secret://deployments/app/from_tf"],
  );
});

async function gitRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprinkleref-check-scope-"));
  await $({ cwd: dir })`git init`.quiet();
  return dir;
}

async function writeTracked(dir: string, file: string, text: string | string[]): Promise<void> {
  const full = path.join(dir, file);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, Array.isArray(text) ? `${text.join("\n")}\n` : text);
  await $({ cwd: dir })`git add ${file}`.quiet();
}

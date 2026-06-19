#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { buildToolsRoot } from "../../dev/dev-build/paths";

const repoRoot = process.cwd();
const viberootsRoot = path.resolve(buildToolsRoot(repoRoot), "..");

test("Infisical bootstrap docs keep interactive confirmation and canonical repo command wording", async () => {
  const docs = await Promise.all(
    ["docs/deployments-usage.md", "docs/infisical-bootstrap.md"].map(
      async (name) => [name, await fsp.readFile(path.join(viberootsRoot, name), "utf8")] as const,
    ),
  );
  for (const [name, text] of docs) {
    assert.doesNotMatch(
      text,
      /--yes flag is required for every non-dry-run bootstrap/,
      `${name} must not describe --yes as mandatory for interactive bootstrap`,
    );
    assert.match(
      text,
      /--yes[\s\S]*(non-interactive|pre-confirm)/,
      `${name} must describe --yes as non-interactive pre-confirmation`,
    );
  }
  assert.doesNotMatch(
    docs.map(([, text]) => text).join("\n"),
    /rerun `infisical-bootstrap\.ts repo`/,
  );
  assert.match(
    docs.map(([, text]) => text).join("\n"),
    /viberoots\/build-tools\/tools\/deployments\/infisical-bootstrap\.ts repo/,
  );
});

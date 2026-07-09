#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

const execFileAsync = promisify(execFile);
const script = viberootsSourcePath("viberoots/build-tools/tools/dev/stale-names-lint.ts");
const retiredInputContractTerm = ["secret", "spec"].join("");

async function writeFixture(name: string, text: string): Promise<string> {
  await fsp.mkdir("buck-out/tmp", { recursive: true });
  const dir = await fsp.mkdtemp(path.join(process.cwd(), "buck-out/tmp/stale-names-"));
  const file = path.join(dir, name);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, text, "utf8");
  return file;
}

test("stale-names-lint rejects internal v1/v2 migration identifiers", async () => {
  const file = await writeFixture(
    "fixture.ts",
    [
      "const internal_helper_v2 = true;",
      "const v2_helper = true;",
      "const v2Helper = true;",
      "type NixosSharedHostInstallManifestV1 = {};",
      "const createInstallManifestV1 = () => ({});",
      "type PreferredHelperV1 = {};",
      "type PreferredTestV1 = {};",
      "const contractParserV2 = {};",
      "const parseContractV2 = () => ({});",
      "const ContractParserV2 = {};",
    ].join("\n"),
  );
  await assert.rejects(
    execFileAsync("zx-wrapper", [script, file], { cwd: process.cwd() }),
    /internal v1\/v2 identifier/,
  );
});

test("stale-names-lint reads parent-owned migration label skip paths", async () => {
  const repo = await fsp.mkdtemp(path.join(process.cwd(), "buck-out/tmp/stale-names-config-"));
  await fsp.mkdir(path.join(repo, "projects/config"), { recursive: true });
  await fsp.writeFile(
    path.join(repo, "projects/config/stale-names-lint.json"),
    JSON.stringify({ migrationLabelSkipPaths: ["projects/demo/state.ts"] }),
    "utf8",
  );
  await fsp.mkdir(path.join(repo, "projects/demo"), { recursive: true });
  await fsp.writeFile(path.join(repo, "projects/demo/state.ts"), "type DemoStateV1 = {};\n");

  const result = await execFileAsync("zx-wrapper", [script, "projects/demo/state.ts"], {
    cwd: repo,
  });
  assert.match(result.stderr, /no stale names found/);
});

test("stale-names-lint keeps external version strings out of migration-label checks", async () => {
  const file = await writeFixture(
    "fixture.ts",
    [
      'const api = "/api/v1/status";',
      'const vault = "kv-v2";',
      'const moduleVersion = "github.com/example/pkg@v1.2.3";',
      'const buckLayout = "buck-out/v2";',
      'const schema = "node-dist-server-v1";',
    ].join("\n"),
  );
  const result = await execFileAsync("zx-wrapper", [script, file], { cwd: process.cwd() });
  assert.match(result.stderr, /no stale names found/);
});

test("stale-names-lint skips opaque binary asset content", async () => {
  const file = await writeFixture("image.png", "bnx DemoStateV1 PR-7 legacy-helper\n");
  const result = await execFileAsync("zx-wrapper", [script, file], { cwd: process.cwd() });
  assert.match(result.stderr, /no stale names found/);
});

test("stale-names-lint rejects active doc command examples with stale labels", async () => {
  const file = await writeFixture(
    "fixture.md",
    "Run this:\n\n```bash\nnode viberoots/build-tools/tools/dev/PR-7-helper.ts\n```\n",
  );
  await assert.rejects(
    execFileAsync("zx-wrapper", [script, file], { cwd: process.cwd() }),
    /completed-plan PR number/,
  );
});

test("stale-names-lint rejects completed phase labels in operational examples", async () => {
  const file = await writeFixture(
    "fixture.md",
    [
      "```bash",
      "VBR_MODE=phase0 ./scripts/Phase-0-helper.sh",
      "env CHECK=phase1 make Phase-1-target",
      "```",
    ].join("\n"),
  );
  await assert.rejects(
    execFileAsync("zx-wrapper", [script, file], { cwd: process.cwd() }),
    /completed-plan phase number/,
  );
});

test("stale-names-lint rejects common active doc command shapes with completed labels", async () => {
  const file = await writeFixture(
    "fixture.md",
    [
      "```bash",
      "bash ./scripts/Phase-0-helper.sh",
      "python scripts/phase0.py",
      "npm run PR-7",
      "```",
    ].join("\n"),
  );
  await assert.rejects(
    execFileAsync("zx-wrapper", [script, file], { cwd: process.cwd() }),
    /completed-plan/,
  );
});

test("stale-names-lint rejects migration labels in active doc command examples", async () => {
  const file = await writeFixture(
    "fixture.md",
    [
      "```bash",
      "scaf new ts legacy-widget demo",
      "bash ./scripts/Phase-0-helper.sh",
      "python scripts/phase0.py",
      "npm run PR-7",
      "sh ./legacy-tool",
      "ruby scripts/phase0.rb",
      "task --mode legacy-mode",
      "feature_flag=legacy-mode ./deploy",
      "```",
    ].join("\n"),
  );
  await assert.rejects(
    execFileAsync("zx-wrapper", [script, file], { cwd: process.cwd() }),
    /legacy\* identifier/,
  );
});

test("stale-names-lint rejects stale names in supplied file paths", async () => {
  const staleNames = [
    "reorg-pr3.txt",
    "docs/pr3-helper.ts",
    "build-tools/foo/pr3.test.ts",
    "legacy-helper.ts",
    `deployment-${retiredInputContractTerm}.ts`,
  ];
  for (const name of staleNames) {
    const file = await writeFixture(name, "const ok = true;\n");
    await assert.rejects(
      execFileAsync("zx-wrapper", [script, file], { cwd: process.cwd() }),
      /stale name|completed-plan|migration label/,
    );
  }
});

test("stale-names-lint rejects retired input-contract term everywhere", async () => {
  const result = await execFileAsync(
    "zx-wrapper",
    [script, "docs/history/plans/deployment-plan.md"],
    {
      cwd: process.cwd(),
    },
  );
  assert.match(result.stderr, /no stale names found/);

  const mixed = await writeFixture(
    "fixture.md",
    `Active docs must use SprinkleRef, not ${retiredInputContractTerm} terminology.\n`,
  );
  await assert.rejects(
    execFileAsync("zx-wrapper", [script, mixed], { cwd: process.cwd() }),
    /retired input-contract term/,
  );
});

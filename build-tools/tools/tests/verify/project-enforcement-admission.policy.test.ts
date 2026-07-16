#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { projectEnforcementAdmissionViolations } from "../../lib/project-enforcement-admission";
import { discoverProjectEnforcementRunners } from "../../lib/project-enforcement-registration";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("all suffix-owned project-enforcement runners satisfy structural admission", async () => {
  const root = viberootsSourcePath("");
  const runners = await discoverProjectEnforcementRunners(root);
  assert.deepEqual(await projectEnforcementAdmissionViolations(runners, root), []);
});

test("structural admission follows imports and rejects every prohibited workload class", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "project-enforcement-admission-"));
  const runnerDir = path.join(root, "build-tools/tools/project-enforcement");
  await fsp.mkdir(runnerDir, { recursive: true });
  await fsp.writeFile(
    path.join(runnerDir, "bad.project-enforcement.test.ts"),
    'import "./heavy";\n',
  );
  await fsp.writeFile(
    path.join(runnerDir, "heavy.ts"),
    [
      'import "node:https";',
      'export * from "./transitive";',
      'runInTemp("consumer", async () => {});',
      'const commands = ["nix build", "pnpm install", "buck2 test"];',
      'await $`${commands.join(";")}`;',
      "createServer().listen(0);",
      "",
    ].join("\n"),
  );
  await fsp.writeFile(
    path.join(runnerDir, "transitive.ts"),
    [
      'import { execFileSync } from "node:child_process";',
      'execFileSync(process.env.TOOL || "nix", ["build"]);',
      "",
    ].join("\n"),
  );
  const runners = await discoverProjectEnforcementRunners(root);
  const violations = await projectEnforcementAdmissionViolations(runners, root);
  assert.match(violations.join("\n"), /temp consumer creation/);
  assert.match(violations.join("\n"), /imports unsupported capability node:https/);
  assert.match(violations.join("\n"), /imports unsupported capability node:child_process/);
  assert.match(violations.join("\n"), /heavy tool execution/);
  assert.match(violations.join("\n"), /unreviewed command execution/);
  assert.match(violations.join("\n"), /service startup/);
  assert.match(violations.join("\n"), /service listener startup/);
});

test("structural admission rejects filesystem mutation across the complete import graph", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "project-enforcement-fs-admission-"));
  const runnerDir = path.join(root, "build-tools/tools/project-enforcement");
  await fsp.mkdir(runnerDir, { recursive: true });
  const mutationMethods = [
    "appendFile",
    "chmod",
    "chown",
    "copyFile",
    "cp",
    "createWriteStream",
    "fchmod",
    "fchown",
    "ftruncate",
    "futimes",
    "link",
    "lchmod",
    "lchown",
    "lutimes",
    "mkdir",
    "mkdtempDisposable",
    "open",
    "rename",
    "rm",
    "rmdir",
    "symlink",
    "truncate",
    "unlink",
    "utimes",
    "write",
    "writeFile",
    "writev",
  ];
  await fsp.writeFile(
    path.join(runnerDir, "bad.project-enforcement.test.ts"),
    [
      'import * as fsp from "node:fs/promises";',
      'import { promises as nested, writeFile as save } from "node:fs";',
      'import "./mutations";',
      'import "./destructure";',
      'import "./computed";',
      'import "./dynamic-computed";',
      'import "./namespace-alias";',
      'import "./typed-bypasses";',
      'import "./argument-escape";',
      'import "./reflect-escape";',
      'import "./namespace-reexport";',
      'import "./promises-reexport";',
      'import "./unknown-named-import";',
      "fsp.rm('direct');",
      "nested.rename('old', 'new');",
      "void save;",
      "",
    ].join("\n"),
  );
  await fsp.writeFile(
    path.join(runnerDir, "mutations.ts"),
    [
      'import * as fs from "node:fs";',
      'export { writeFile as exportedWrite } from "node:fs/promises";',
      ...mutationMethods.map((method) => `fs.${method}('fixture');`),
      "",
    ].join("\n"),
  );
  const bypasses = {
    "destructure.ts": [
      'import * as fsp from "node:fs/promises";',
      "const { writeFile: hiddenWrite } = fsp;",
      "void hiddenWrite;",
    ],
    "computed.ts": ['import * as fsp from "node:fs/promises";', 'void fsp["writeFile"];'],
    "dynamic-computed.ts": [
      'import * as fsp from "node:fs/promises";',
      'const method = "readFile";',
      "void fsp[method];",
    ],
    "namespace-alias.ts": [
      'import * as fsp from "node:fs/promises";',
      "const hidden = fsp;",
      "void hidden;",
    ],
    "typed-bypasses.ts": [
      'import * as fsp from "node:fs/promises";',
      "const { writeFile: hiddenWrite }: typeof fsp = fsp;",
      "const hidden: typeof fsp = fsp;",
      "void (fsp as unknown);",
      "void hiddenWrite;",
      "void hidden;",
    ],
    "argument-escape.ts": [
      'import * as fsp from "node:fs/promises";',
      "declare function take(value: unknown): void;",
      "take(fsp);",
    ],
    "reflect-escape.ts": [
      'import * as fsp from "node:fs/promises";',
      'void Reflect.get(fsp, "writeFile");',
    ],
    "namespace-reexport.ts": ['export * as fs from "node:fs";'],
    "promises-reexport.ts": ['export { promises as fsp } from "node:fs";'],
    "unknown-named-import.ts": ['import { constants } from "node:fs";', "void constants;"],
  };
  for (const [name, lines] of Object.entries(bypasses)) {
    await fsp.writeFile(path.join(runnerDir, name), `${lines.join("\n")}\n`);
  }
  const runners = await discoverProjectEnforcementRunners(root);
  const violations = await projectEnforcementAdmissionViolations(runners, root);
  assert.equal(
    violations.filter((line) => line.includes("filesystem mutation capability")).length,
    12,
  );
  for (const name of Object.keys(bypasses)) {
    assert.ok(
      violations.some((line) => line.includes(name)),
      `${name} bypass was admitted`,
    );
  }
});

test("structural admission retains the scanners' reviewed read-only filesystem capabilities", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "project-enforcement-read-admission-"));
  const runnerDir = path.join(root, "build-tools/tools/project-enforcement");
  await fsp.mkdir(runnerDir, { recursive: true });
  await fsp.writeFile(
    path.join(runnerDir, "good.project-enforcement.test.ts"),
    [
      'import * as fs from "node:fs";',
      'import * as fsp from "node:fs/promises";',
      'import { promises as nested, readFile as read } from "node:fs";',
      "await fsp.access('fixture');",
      "await fsp.lstat('fixture');",
      "await fsp.readFile('fixture');",
      "await fsp.readdir('fixture');",
      "await fsp.stat('fixture');",
      "fs.createReadStream('fixture');",
      "await nested.access('fixture');",
      "await read('fixture');",
      'await fsp["readFile"]("fixture");',
      "",
    ].join("\n"),
  );
  const runners = await discoverProjectEnforcementRunners(root);
  assert.deepEqual(await projectEnforcementAdmissionViolations(runners, root), []);
});

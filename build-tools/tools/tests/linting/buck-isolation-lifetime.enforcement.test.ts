#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { findBuckIsolationLifetimeViolations } from "./buck-isolation-lifetime-lint.ts";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

const SELF = "build-tools/tools/tests/linting/buck-isolation-lifetime.enforcement.test.ts";

async function listTestFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      if (entry.isFile() && entry.name.endsWith(".test.ts")) files.push(absolute);
    }
  }
  return files.sort();
}

test("Buck isolation lifetime lint rejects unsafe temp and fixed-isolation cleanup", () => {
  const unsafeTemp = String.raw`
test("unsafe temp", async () => {
  const workspace = await fsp.mkdtemp("fixture-");
  await $\`buck2 --isolation-dir \${inheritedBuckIsolation("fixture")} build //:x\`;
  await fsp.rm(workspace, { recursive: true });
});
`;
  const unsafeFixed = String.raw`
const wrapperIsolation = inheritedBuckIsolation("wrapper");
test("unsafe fixed", async () => {
  await $\`buck2 --isolation-dir \${wrapperIsolation} audit providers //:x\`;
});
`;
  const unsafeInline = String.raw`
test("unsafe inline", async () => {
  await $\`buck2 --isolation-dir \${inheritedBuckIsolation("inline")} audit providers //:x\`;
});
`;
  const reasons = [
    ...findBuckIsolationLifetimeViolations(unsafeTemp),
    ...findBuckIsolationLifetimeViolations(unsafeFixed),
    ...findBuckIsolationLifetimeViolations(unsafeInline),
  ].map((violation) => violation.reason);
  if (
    reasons.length !== 3 ||
    !reasons.some((reason) => reason.includes("temporary Buck repo")) ||
    reasons.filter((reason) => reason.includes("exact after-hook")).length !== 2
  ) {
    throw new Error(`expected all isolation lifetime violations, got ${JSON.stringify(reasons)}`);
  }
});

test("Buck isolation lifetime lint accepts daemon cleanup before removal and exact after hooks", () => {
  const safe = String.raw`
const wrapperIsolation = inheritedBuckIsolation("wrapper");
const tempIsolation = inheritedBuckIsolation("fixture");
after(async () => await killBuckIsolation(process.cwd(), wrapperIsolation));
after(async () => await killBuckIsolation(process.cwd(), tempIsolation));
test("safe temp", async () => {
  const workspace = await fsp.mkdtemp("fixture-");
  await withAsyncCleanup(
    async () => {
      await $\`buck2 --isolation-dir \${tempIsolation} build //:x\`;
    },
    async () => await runAsyncCleanupSteps([
      async () => await killBuckDaemonsForRepo(workspace, $),
      async () => await fsp.rm(workspace, { recursive: true }),
    ]),
  );
});
test("safe fixed", async () => {
  await $\`buck2 --isolation-dir \${wrapperIsolation} audit providers //:x\`;
});
`;
  const safeInline = String.raw`
after(async () => await killBuckIsolation(process.cwd(), inheritedBuckIsolation("inline")));
test("safe inline", async () => {
  await $\`buck2 --isolation-dir \${inheritedBuckIsolation("inline")} audit providers //:x\`;
});
`;
  const violations = [
    ...findBuckIsolationLifetimeViolations(safe),
    ...findBuckIsolationLifetimeViolations(safeInline),
  ];
  if (violations.length !== 0) {
    throw new Error(`expected safe cleanup patterns, got ${JSON.stringify(violations)}`);
  }
});

test("Buck-using tests cannot omit timely isolation cleanup", async () => {
  const repoRoot = viberootsSourcePath(".");
  const files = await listTestFiles(viberootsSourcePath("build-tools/tools/tests"));
  const violations: string[] = [];
  for (const file of files) {
    const relative = path.relative(repoRoot, file).replaceAll("\\", "/");
    if (relative === SELF) continue;
    const text = await fsp.readFile(file, "utf8");
    for (const violation of findBuckIsolationLifetimeViolations(text)) {
      violations.push(`${relative}:${violation.line} ${violation.reason}`);
    }
  }
  if (violations.length > 0) {
    throw new Error(`Found unsafe Buck daemon lifetimes:\n${violations.join("\n")}`);
  }
});

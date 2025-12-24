#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

type Finding = { file: string; hint: string };

const CANONICAL_IMPLEMENTATION_FILES = new Set([
  "tools/patch/lib/importer-local-patch-dir.ts",
  "tools/patch/lib/workspace-workflow.ts",
]);

const PATCH_ENTRYPOINT_PREFIX = "tools/patch/patch-";

const BANNED_IMPORTER_LOCAL_PATCH_DIR_PATTERNS: Array<{ re: RegExp; hint: string }> = [
  {
    re: /\bdefaultImporterPatchDir\s*\(/,
    hint: "Do not call defaultImporterPatchDir(...) from patch tooling entrypoints. Use tools/patch/lib/importer-local-patch-dir.ts:resolveImporterLocalPatchDir(...).",
  },
  {
    re: /\bpath\.join\s*\([^)]*\b(?:importerDir|importerDirAbs)\b[^)]*["']patches["'][^)]*["'](?:node|python)["'][^)]*\)/,
    hint: "Do not assemble <importer>/patches/<lang> paths in entrypoints. Use tools/patch/lib/importer-local-patch-dir.ts:resolveImporterLocalPatchDir(...).",
  },
  {
    re: /\bpath\.resolve\s*\([^)]*\b(?:importerDir|importerDirAbs)\b[^)]*["']patches["'][^)]*["'](?:node|python)["'][^)]*\)/,
    hint: "Do not assemble <importer>/patches/<lang> paths in entrypoints. Use tools/patch/lib/importer-local-patch-dir.ts:resolveImporterLocalPatchDir(...).",
  },
];

const BANNED_WORKSPACE_SESSION_LOGIC_PATTERNS: Array<{ re: RegExp; hint: string }> = [
  {
    re: /from\s+["']\.\/state["']/,
    hint: "Workspace-based patch entrypoints must not interact with tools/patch/state.ts directly. Use tools/patch/lib/workspace-workflow.ts (start/apply/reset) for Go and Python.",
  },
  {
    re: /from\s+["']\.\.\/state["']/,
    hint: "Workspace-based patch entrypoints must not interact with tools/patch/state.ts directly. Use tools/patch/lib/workspace-workflow.ts (start/apply/reset) for Go and Python.",
  },
  {
    re: /\bgetSession\s*\(/,
    hint: "Workspace-based patch entrypoints must not call getSession(...). Use tools/patch/lib/workspace-workflow.ts for session reuse and no-op cleanup.",
  },
  {
    re: /\bsetSession\s*\(/,
    hint: "Workspace-based patch entrypoints must not call setSession(...). Use tools/patch/lib/workspace-workflow.ts for session creation.",
  },
  {
    re: /\bdeleteSession\s*\(/,
    hint: "Workspace-based patch entrypoints must not call deleteSession(...). Use tools/patch/lib/workspace-workflow.ts for session cleanup.",
  },
];

function rel(p: string): string {
  return p.replaceAll("\\", "/");
}

async function listPatchEntrypoints(repoRoot: string): Promise<string[]> {
  const dir = path.join(repoRoot, "tools/patch");
  const ents = await fsp.readdir(dir, { withFileTypes: true } as any);
  const files = ents
    .filter((e) => e.isFile() && e.name.startsWith("patch-") && e.name.endsWith(".ts"))
    .map((e) => rel(path.join("tools/patch", e.name)));
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function scanFileForFindings(opts: { relFile: string; txt: string }): Finding[] {
  if (CANONICAL_IMPLEMENTATION_FILES.has(opts.relFile)) return [];

  const findings: Finding[] = [];
  for (const { re, hint } of BANNED_IMPORTER_LOCAL_PATCH_DIR_PATTERNS) {
    if (re.test(opts.txt)) findings.push({ file: opts.relFile, hint });
  }
  return findings;
}

function scanWorkspaceEntrypointForFindings(opts: { relFile: string; txt: string }): Finding[] {
  const findings: Finding[] = [];
  for (const { re, hint } of BANNED_WORKSPACE_SESSION_LOGIC_PATTERNS) {
    if (re.test(opts.txt)) findings.push({ file: opts.relFile, hint });
  }
  return findings;
}

test("patch tooling entrypoints stay on shared helper boundaries (importer-local patch dir + workspace workflow)", async () => {
  const repoRoot = process.cwd();

  const entrypoints = await listPatchEntrypoints(repoRoot);
  assert(entrypoints.length > 0, "expected at least one patch-* entrypoint under tools/patch/");

  const hits: Finding[] = [];
  for (const f of entrypoints) {
    const abs = path.join(repoRoot, f);
    const txt = await fsp.readFile(abs, "utf8");

    hits.push(...scanFileForFindings({ relFile: f, txt }));

    if (f === "tools/patch/patch-go.ts" || f === "tools/patch/patch-python.ts") {
      hits.push(...scanWorkspaceEntrypointForFindings({ relFile: f, txt }));
    }
  }

  // Positive control: canonical helper impls should never be flagged.
  for (const helper of CANONICAL_IMPLEMENTATION_FILES) {
    const abs = path.join(repoRoot, helper);
    const txt = await fsp.readFile(abs, "utf8");
    const helperHits = scanFileForFindings({ relFile: helper, txt });
    assert(helperHits.length === 0, `canonical helper file must not be flagged: ${helper}`);
  }

  // Positive control: fixture with banned patterns must be flagged.
  const fixture = "tools/tests/fixtures/patching/patch-tooling-bespoke-patterns.ts";
  const fixtureTxt = await fsp.readFile(path.join(repoRoot, fixture), "utf8");
  const fixtureHits = scanFileForFindings({ relFile: fixture, txt: fixtureTxt });
  assert(
    fixtureHits.length > 0,
    `fixture must trigger at least one banned pattern check: ${fixture}`,
  );

  if (hits.length > 0) {
    const msg = hits
      .slice(0, 50)
      .map((h) => `- ${h.file}\n  ${h.hint}`)
      .join("\n");
    const tail = hits.length > 50 ? `\n... and ${hits.length - 50} more` : "";
    throw new Error(
      [
        "Patch tooling drift detected.",
        "Patch tooling entrypoints must use shared helper boundaries to prevent reintroducing bespoke patch-dir and session logic.",
        "",
        msg + tail,
      ].join("\n"),
    );
  }
});

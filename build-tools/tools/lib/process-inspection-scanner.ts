import * as fsp from "node:fs/promises";
import path from "node:path";

const EXCLUDED_DIRS = new Set([
  ".claude",
  ".codex",
  ".git",
  ".viberoots",
  "backups",
  "codex-test-logs",
  ".direnv",
  ".nix-zsh",
  "buck-out",
  "coverage",
  "dist",
  "docs",
  "node_modules",
  "result",
  "pr-logs",
  "test-logs",
]);

const ALLOWED_PATHS = new Set([
  "build-tools/tools/bin/kill-all",
  "build-tools/tools/dev/tail-log/resolve.ts",
  "build-tools/tools/dev/verify/lock.ts",
  "build-tools/tools/dev/verify/owned-process-state.ts",
  "build-tools/tools/dev/verify/process-control.ts",
  "build-tools/tools/dev/verify/temp-repo-process-cleanup.ts",
  "build-tools/tools/lib/process-inspection.ts",
  "build-tools/tools/lib/process-inspection-scanner.ts",
  "build-tools/tools/lib/open-file-inspection.ts",
  "build-tools/tools/lib/shared-buck-isolation-lock.ts",
  "build-tools/tools/nix/flake/packages/remote-worker-tools.nix",
  "build-tools/tools/tests/dev/verify.orphan-owned-process-cleanup.helpers.ts",
  "build-tools/tools/tests/dev/verify.temp-repo-buck-cleanup.scoped.test.ts",
  "build-tools/tools/tests/lib/buck-daemon-cleanup.interrupted.test.ts",
  "build-tools/tools/tests/lib/buck-daemon-cleanup.non-disruptive.test.ts",
  "build-tools/tools/tests/lib/buck-daemon-reaper.exits-after-parent-exit.test.ts",
  "build-tools/tools/tests/lib/buck-daemon-reaper.ts",
  "build-tools/tools/tests/lib/buck-daemon-reaper.verify-owned-processes.test.ts",
  "build-tools/tools/tests/lib/buck-procs.ps-fallback.test.ts",
  "build-tools/tools/tests/lib/process-inspection.safehouse.test.ts",
  "build-tools/tools/tests/lib/open-file-inspection.test.ts",
  "build-tools/tools/tests/nix/remote-worker-tools.test.ts",
  "build-tools/tools/tests/lib/process-tree.ts",
  "build-tools/tools/tests/lib/test-helpers/buck-procs.ts",
  "build-tools/tools/tests/lib/test-helpers/buck-reaper.ts",
  "build-tools/tools/tests/linting/process-inspection-commands.enforcement.test.ts",
  "TESTING.md",
  "ps.txt",
]);

const ALLOWED_PATH_PATTERNS = [/^projects\/apps\/[^/]+\/e2e\/process-control\.ts$/];

const PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /resolveToolPath(?:Sync)?\(["']ps["']\)/g, label: "ps tool resolution" },
  { re: /(?:^|[^A-Za-z0-9_-])\/bin\/ps(?:$|[^A-Za-z0-9_-])/g, label: "/bin/ps" },
  { re: /(?:^|[^A-Za-z0-9_-])ps\s+-[A-Za-z]/g, label: "ps command" },
  { re: /(?:^|[^A-Za-z0-9_-])pgrep(?:$|[^A-Za-z0-9_-])/g, label: "pgrep command" },
  { re: /(?:^|[^A-Za-z0-9_-])pkill(?:$|[^A-Za-z0-9_-])/g, label: "pkill command" },
  { re: /(?:^|[^A-Za-z0-9_-])killall(?:$|[^A-Za-z0-9_-])/g, label: "killall command" },
  { re: /(?:^|[^A-Za-z0-9_-])lsof(?:$|[^A-Za-z0-9_-])/g, label: "lsof command" },
];

export function normalizeProcessInspectionPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function reviewedPath(value: string): string {
  const rel = normalizeProcessInspectionPath(value);
  return rel.startsWith("viberoots/") ? rel.slice("viberoots/".length) : rel;
}

export function isProcessInspectionPathAllowed(value: string): boolean {
  const reviewed = reviewedPath(value);
  return (
    ALLOWED_PATHS.has(reviewed) || ALLOWED_PATH_PATTERNS.some((pattern) => pattern.test(reviewed))
  );
}

export function scanProcessInspectionText(rel: string, text: string): string[] {
  if (isProcessInspectionPathAllowed(rel)) return [];
  const hits: string[] = [];
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern.re)) {
      const line = text.slice(0, match.index ?? 0).split("\n").length;
      hits.push(`${normalizeProcessInspectionPath(rel)}:${line} direct ${pattern.label}`);
    }
  }
  return hits;
}

function isExcludedDir(relDir: string): boolean {
  return normalizeProcessInspectionPath(relDir)
    .split("/")
    .filter(Boolean)
    .some((part) => EXCLUDED_DIRS.has(part));
}

export async function scanProcessInspectionTree(opts: {
  root: string;
  pathPrefix?: string;
}): Promise<string[]> {
  const files: string[] = [];
  const stack = [opts.root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (isExcludedDir(path.relative(opts.root, current))) continue;
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch (error) {
      throw new Error(`process inspection scanner cannot read directory ${current}`, {
        cause: error,
      });
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.isFile()) files.push(abs);
    }
  }
  const hits: string[] = [];
  for (const abs of files.sort()) {
    const local = normalizeProcessInspectionPath(path.relative(opts.root, abs));
    const rel = opts.pathPrefix
      ? `${normalizeProcessInspectionPath(opts.pathPrefix)}/${local}`
      : local;
    try {
      hits.push(...scanProcessInspectionText(rel, await fsp.readFile(abs, "utf8")));
    } catch (error) {
      throw new Error(`process inspection scanner cannot read file ${abs}`, { cause: error });
    }
  }
  return hits;
}

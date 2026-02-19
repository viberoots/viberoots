#!/usr/bin/env zx-wrapper
// Kill stale buck2 daemons by isolation name, safely and surgically.
// Usage examples:
//   node build-tools/tools/dev/buck-kill-stale.ts --list
//   node build-tools/tools/dev/buck-kill-stale.ts --kill --include exporter- --dry-run
//   node build-tools/tools/dev/buck-kill-stale.ts --kill --include '^zxtest-' --yes
import { getFlagBool, getFlagStr } from "../lib/cli.ts";

type Args = {
  list?: boolean;
  kill?: boolean;
  include?: string;
  exclude?: string;
  yes?: boolean;
  dryRun?: boolean;
};

function toRegex(s?: string): RegExp | null {
  if (!s || !String(s).trim()) return null;
  try {
    return new RegExp(String(s));
  } catch {
    console.error("invalid regex:", s);
    process.exit(2);
  }
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

async function psLines(): Promise<string[]> {
  // Cross-platform-ish: use a broad format including command and args
  const args =
    process.platform === "darwin"
      ? ["/bin/ps", "-A", "-o", "pid=,command="]
      : ["ps", "-e", "-o", "pid=,command="];
  const { stdout } = await $({ stdio: "pipe" })`${args}`;
  return String(stdout || "")
    .split(/\r?\n/)
    .filter(Boolean);
}

function extractBuckIsolations(lines: string[]): Array<{ pid: string; iso: string }> {
  const out: Array<{ pid: string; iso: string }> = [];
  for (const line of lines) {
    const pidMatch = line.match(/^\s*(\d+)\s+/);
    if (!pidMatch) continue;
    const pid = pidMatch[1];
    // Prefer explicit isolation-dir argument (matches both buck2 and buck2d command shapes).
    const isoArg = line.match(/--isolation-dir\s+([^\s]+)/);
    if (isoArg) {
      out.push({ pid, iso: isoArg[1] });
      continue;
    }
    // Fallback for command forms that only expose buck2d[isolation].
    const daemonIso = line.match(/\bbuck2d\[([^\]]+)\]/);
    if (daemonIso) {
      out.push({ pid, iso: daemonIso[1] });
    }
  }
  return out;
}

function filterIsolations(
  items: Array<{ pid: string; iso: string }>,
  includeRe: RegExp | null,
  excludeRe: RegExp | null,
): Array<{ pid: string; iso: string }> {
  return items.filter(({ iso }) => {
    if (includeRe && !includeRe.test(iso)) return false;
    if (excludeRe && excludeRe.test(iso)) return false;
    return true;
  });
}

async function confirm(question: string): Promise<boolean> {
  process.stdout.write(question + " [y/N] ");
  try {
    const { stdout } = await $({
      stdio: "pipe",
    })`bash --noprofile --norc -c 'read -r a; printf "%s" "$a"'`;
    const ans = String(stdout || "")
      .trim()
      .toLowerCase();
    return ans === "y" || ans === "yes";
  } catch {
    return false;
  }
}

async function main() {
  const listFlag = getFlagBool("list");
  const killFlag = getFlagBool("kill");
  const includeRe = toRegex(getFlagStr("include", "").trim());
  const excludeRe = toRegex(getFlagStr("exclude", "").trim());
  const dryRun = getFlagBool("dry-run") || getFlagBool("dryRun");
  const autoYes = getFlagBool("yes");
  const listOnly = listFlag || (!killFlag && !listFlag);
  const doKill = killFlag;

  const lines = await psLines();
  const entries = extractBuckIsolations(lines);
  const filtered = filterIsolations(entries, includeRe, excludeRe);
  const groups = new Map<string, string[]>();
  for (const e of filtered) {
    const arr = groups.get(e.iso) || [];
    arr.push(e.pid);
    groups.set(e.iso, arr);
  }

  if (groups.size === 0) {
    console.log("no buck2d processes found matching filters");
    return;
  }

  // Print summary
  const rows: Array<{ iso: string; pids: string[] }> = Array.from(groups.entries())
    .map(([iso, pids]) => ({ iso, pids: unique(pids) }))
    .sort((a, b) => a.iso.localeCompare(b.iso));

  for (const r of rows) {
    console.log(`${r.iso}  (pids: ${r.pids.join(",")})`);
  }
  console.log(`total isolations: ${rows.length}`);

  if (listOnly) return;

  if (!dryRun && !autoYes) {
    const ok = await confirm("Proceed to kill the above isolations?");
    if (!ok) {
      console.log("aborted");
      return;
    }
  }

  let failures = 0;
  for (const r of rows) {
    const iso = r.iso;
    if (dryRun) {
      console.log(`[dry-run] buck2 --isolation-dir ${iso} kill`);
      continue;
    }
    try {
      await $`buck2 --isolation-dir ${iso} kill`;
      console.log(`killed ${iso}`);
    } catch (e) {
      failures++;
      console.error(`failed to kill ${iso}:`, e);
    }
  }
  if (failures) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

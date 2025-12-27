export type Mode = "tail" | "status";
export type Selection = { kind: "latest" } | { kind: "pid"; pid: number };

export type TailLogArgs = {
  mode: Mode;
  json: boolean;
  watch: boolean;
  watchIntervalSec: number;
  lines?: number;
  selection: Selection;
  help: boolean;
  usage: string;
};

function usage(): string {
  return [
    "usage:",
    "  tools/bin/tail-log [-n LINES] [PID]",
    "  tools/bin/l        [-n LINES] [PID]",
    "  tools/bin/tail-log --status [--json] [PID]",
    "  tools/bin/l        --status [--json] [PID]",
    "  tools/bin/tail-log --status -w [SECONDS] [--json] [PID]",
    "  tools/bin/l        --status -w [SECONDS] [--json] [PID]",
    "",
    "If PID is omitted:",
    "  - follows the latest verify run log (lock-first; falls back to latest.log, then newest verify-*.log)",
    "  - in --status -w mode: switches automatically when a new verify run starts",
    "",
    "If -n is provided:",
    "  - uses 'tail -n LINES' (no follow)",
    "",
    "If --status is provided:",
    "  - computes counters from the full log file and exits (no follow)",
    "  - with -w/--watch: re-runs status repeatedly (always full-log scan)",
    "  - when no verify is running: shows status for the most recent verify log (if present)",
    "",
  ].join("\n");
}

function isInt(s: string): boolean {
  return /^[0-9]+$/.test(s);
}

export function parseTailLogArgs(argv: string[]): TailLogArgs {
  const out: TailLogArgs = {
    mode: "tail",
    json: false,
    watch: false,
    watchIntervalSec: 0.25,
    selection: { kind: "latest" },
    help: false,
    usage: usage(),
  };

  let i = 0;
  while (i < argv.length) {
    const t = argv[i] || "";
    if (t === "-h" || t === "--help") {
      out.help = true;
      i++;
      continue;
    }
    if (t === "--status") {
      out.mode = "status";
      i++;
      continue;
    }
    if (t === "--json") {
      out.json = true;
      i++;
      continue;
    }
    if (t === "-w" || t === "--watch") {
      out.watch = true;
      const nxt = argv[i + 1];
      if (nxt && !nxt.startsWith("-")) {
        out.watchIntervalSec = Number(nxt);
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    if (t.startsWith("--watch=")) {
      out.watch = true;
      out.watchIntervalSec = Number(t.slice("--watch=".length));
      i++;
      continue;
    }
    if (t === "-n") {
      const nxt = argv[i + 1] || "";
      out.lines = Number(nxt);
      i += 2;
      continue;
    }
    if (t.startsWith("-n")) {
      out.lines = Number(t.slice(2));
      i++;
      continue;
    }

    if (t) {
      if (argv.length !== i + 1) {
        throw new Error(`unexpected extra args: ${argv.slice(i + 1).join(" ")}`);
      }
      if (!isInt(t)) throw new Error(`expected PID as an integer, got: ${t}`);
      out.selection = { kind: "pid", pid: Number(t) };
      i++;
      continue;
    }
    i++;
  }

  if (out.watch && out.mode !== "status") throw new Error("-w/--watch requires --status");
  if (out.mode === "status" && out.lines !== undefined)
    throw new Error("-n cannot be combined with --status");
  if (out.lines !== undefined && (!Number.isInteger(out.lines) || out.lines <= 0)) {
    throw new Error(`-n expects integer lines, got: ${String(out.lines)}`);
  }
  if (out.watch && (!Number.isFinite(out.watchIntervalSec) || out.watchIntervalSec <= 0)) {
    throw new Error(
      `-w/--watch interval must be seconds (e.g. 0.25), got: ${String(out.watchIntervalSec)}`,
    );
  }
  return out;
}

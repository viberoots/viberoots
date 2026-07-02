export type CommandUi = {
  verbose: boolean;
  heading: (label: string) => void;
  step: (label: string, detail?: string) => void;
  ok: (label: string, detail?: string) => void;
  warn: (message: string) => void;
  list: (items: string[], opts?: { stream?: "stdout" | "stderr"; limit?: number }) => void;
  verboseLog: (message: string) => void;
};

const TRUE_VALUES = new Set(["1", "true", "yes", "on", "debug", "trace"]);

export function isVbrVerbose(env: NodeJS.ProcessEnv = process.env): boolean {
  return TRUE_VALUES.has(
    String(env.VBR_VERBOSE || "")
      .trim()
      .toLowerCase(),
  );
}

function useColor(env: NodeJS.ProcessEnv = process.env): boolean {
  return process.stdout.isTTY && String(env.NO_COLOR || "").trim() === "";
}

function color(code: string, value: string, enabled: boolean): string {
  return enabled ? `\u001b[${code}m${value}\u001b[0m` : value;
}

function formatStatus(kind: "step" | "ok" | "warn", label: string, detail = ""): string {
  const colors = useColor();
  const mark = kind === "ok" ? "ok" : kind === "warn" ? "warn" : "run";
  const code = kind === "ok" ? "32;1" : kind === "warn" ? "33;1" : "34;1";
  const gap = " ".repeat(Math.max(1, 6 - mark.length));
  const renderedMark = color(code, mark, colors);
  const suffix = detail.trim() ? ` ${color("2", detail.trim(), colors)}` : "";
  return `  ${renderedMark}${gap}${label}${suffix}`;
}

export function createCommandUi(opts?: { verbose?: boolean }): CommandUi {
  const verbose = opts?.verbose ?? isVbrVerbose();
  return {
    verbose,
    heading: (label) => {
      if (!verbose) process.stdout.write(`${color("1;38;5;141", label, useColor())}\n`);
    },
    step: (label, detail) => {
      if (verbose) return;
      process.stdout.write(`${formatStatus("step", label, detail)}\n`);
    },
    ok: (label, detail) => {
      if (verbose) return;
      process.stdout.write(`${formatStatus("ok", label, detail)}\n`);
    },
    warn: (message) => {
      process.stderr.write(`${formatStatus("warn", message)}\n`);
    },
    list: (items, opts) => {
      if (verbose || items.length === 0) return;
      const stream = opts?.stream === "stderr" ? process.stderr : process.stdout;
      const limit = Math.max(1, opts?.limit ?? 8);
      for (const item of items.slice(0, limit)) {
        stream.write(`    - ${item}\n`);
      }
      if (items.length > limit) {
        stream.write(`    - ... ${items.length - limit} more\n`);
      }
    },
    verboseLog: (message) => {
      if (verbose) process.stdout.write(`${message}\n`);
    },
  };
}

import type { VerifyStatus } from "./types.ts";

export function formatVerifyStatusJsonLine(st: VerifyStatus): string {
  // Stable JSON keys for scripting.
  const out = {
    pid: st.pid,
    pass: st.pass,
    fail: st.fail,
    fatal: st.fatal,
    skip: st.skip,
    build_failure: st.buildFailure,
    remaining: st.remaining ?? null,
    failed: st.failed,
    done: st.done,
    elapsed: st.elapsed ?? null,
    gc_detected: st.gcDetected,
    log: st.logPath,
    source: st.source,
    pass_name: st.passName ?? null,
    pass_index: st.passIndex ?? null,
    pass_total: st.passTotal ?? null,
  };
  return JSON.stringify(out);
}

export function formatVerifyStatusText(
  st: VerifyStatus,
  opts: {
    isTty: boolean;
  },
): string {
  const elapsed = st.elapsed ? st.elapsed : "?";
  const remaining = st.remaining !== undefined ? String(st.remaining) : "?";
  const isTty = opts.isTty;

  const anyFailures = st.fail > 0 || st.fatal > 0 || st.buildFailure > 0;
  // Color policy:
  // - blue if no failures, still running, and GC has been detected
  // - orange if failures and still running
  // - yellow if no failures and still running
  // - green if done with no failures
  // - red if done with failures
  const RESET = "\u001b[0m";
  const YELLOW = "\u001b[33m";
  const GREEN = "\u001b[32m";
  const BLUE = "\u001b[34m";
  const RED = "\u001b[31m";
  const ORANGE = "\u001b[38;5;208m";
  const color =
    !st.done && !anyFailures && st.gcDetected
      ? BLUE
      : st.done && anyFailures
        ? RED
        : st.done && !anyFailures
          ? GREEN
          : !st.done && anyFailures
            ? ORANGE
            : YELLOW;

  const DIM = "\u001b[2m";
  const label = (s: string) => (isTty ? `${DIM}${s}${RESET}` : s);
  const val = (s: string) => (isTty ? `${color}${s}${RESET}` : s);
  const red = (s: string) => (isTty ? `${RED}${s}${RESET}` : s);

  const lines: string[] = [];
  lines.push(`${label("Time elapsed:")}    ${val(elapsed)}`);
  if (st.passName && st.passIndex && st.passTotal) {
    lines.push(
      `${label("Pass group:")}      ${val(`${st.passName} (${st.passIndex}/${st.passTotal})`)}`,
    );
  }
  lines.push(`${label(st.done ? "Tests finished:" : "Tests so far:")}`);
  lines.push(`  ${val(`Pass:          ${st.pass}`)}`);
  lines.push(`  ${val(`Fail:          ${st.fail}`)}`);
  lines.push(`  ${val(`Fatal:         ${st.fatal}`)}`);
  lines.push(`  ${val(`Skip:          ${st.skip}`)}`);
  lines.push(`  ${val(`Build failure: ${st.buildFailure}`)}`);
  lines.push(`${label("----------------------")}`);
  lines.push(`${label("Tests remaining:")} ${val(remaining)}`);
  lines.push(`${label("GC detected:")} ${val(st.gcDetected ? "yes" : "no")}`);
  lines.push(st.logPath);

  if (st.failed.length > 0) {
    const cap = 10;
    const shown = st.failed.slice(0, cap);
    lines.push("");
    lines.push(val(`Failing tests (${st.failed.length}):`));
    for (const t of shown) {
      lines.push(red(`  - ${t}`));
    }
    if (st.failed.length > cap) {
      lines.push(red(`  ... and ${st.failed.length - cap} more`));
    }
    lines.push("");
  }

  return lines.join("\n");
}

import type { VerifyStatus } from "./types";
import { formatProgressBar as formatSharedProgressBar } from "../progress-bar";

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
    stopped: st.stopped ?? false,
    stop_reason: st.stopReason ?? null,
    elapsed: st.elapsed ?? null,
    projected_duration: st.projectedDuration ?? null,
    projected_end_time: st.projectedEndTime ?? null,
    gc_detected: st.gcDetected,
    log: st.logPath,
    source: st.source,
    pass_name: st.passName ?? null,
    pass_index: st.passIndex ?? null,
    pass_total: st.passTotal ?? null,
    group_completed: st.groupCompleted ?? null,
    group_total: st.groupTotal ?? null,
    pass_groups: (st.passGroups || []).map((group) => ({
      name: group.name,
      index: group.index,
      total: group.total,
      completed: group.completed ?? null,
      target_count: group.targetCount ?? null,
      pass: group.pass,
      fail: group.fail,
      fatal: group.fatal,
      skip: group.skip,
      build_failure: group.buildFailure,
      completion_rate_avg_per_minute: group.completionRateAvgPerMinute ?? null,
      done: group.done,
      active: group.active,
    })),
  };
  return JSON.stringify(out);
}

function formatRate(rate: number | undefined): string {
  if (rate === undefined || !Number.isFinite(rate)) return "?";
  return `${rate.toFixed(rate < 10 ? 1 : 0)} tests/min`;
}

function parseDurationSeconds(value: string | undefined): number | undefined {
  const text = String(value || "").trim();
  if (!text || text === "?") return undefined;
  const compact = /^(\d+)m(\d+)s$/.exec(text);
  if (compact) return Number(compact[1]) * 60 + Number(compact[2]);
  const parts = text.split(":").map((part) => Number(part));
  if (parts.length === 2 && parts.every(Number.isFinite)) return parts[0] * 60 + parts[1];
  if (parts.length === 3 && parts.every(Number.isFinite)) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return undefined;
}

function formatProgressBar(ratio: number | undefined): string {
  const width = 32;
  if (ratio === undefined || !Number.isFinite(ratio)) return "?";
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

function formatPassGroupProgress(
  group: NonNullable<VerifyStatus["passGroups"]>[number],
  widths: { name: number; progress: number; state: number },
): string {
  const progress =
    group.completed === undefined || group.targetCount === undefined
      ? "?"
      : `${group.completed}/${group.targetCount}`;
  const state =
    group.done && (group.fail > 0 || group.fatal > 0 || group.buildFailure > 0)
      ? "failed"
      : group.done
        ? "done"
        : group.active
          ? "running"
          : "pending";
  const ratio =
    group.completed === undefined || group.targetCount === undefined || group.targetCount <= 0
      ? undefined
      : group.completed / group.targetCount;
  return `${group.name.padEnd(widths.name)} ${formatSharedProgressBar(ratio, 24)} ${progress.padStart(widths.progress)} ${state.padEnd(widths.state)} ${formatRate(group.completionRateAvgPerMinute)} avg`;
}

export function formatVerifyStatusText(
  st: VerifyStatus,
  opts: {
    isTty: boolean;
  },
): string {
  const elapsed = st.elapsed ? st.elapsed : "?";
  const projectedDuration = st.projectedDuration ? st.projectedDuration : "?";
  const projectedEndTime = st.projectedEndTime ? st.projectedEndTime : "?";
  const remaining = st.remaining !== undefined ? String(st.remaining) : "?";
  const isTty = opts.isTty;
  const completed = st.pass + st.fail + st.fatal + st.skip;
  const total = st.remaining === undefined ? undefined : completed + st.remaining;
  const testsProgress = total === undefined || total <= 0 ? undefined : `${completed}/${total}`;
  const testsRatio = total === undefined || total <= 0 ? undefined : completed / Math.max(1, total);
  const elapsedSeconds = parseDurationSeconds(st.elapsed);
  const projectedSeconds = parseDurationSeconds(st.projectedDuration);
  const timeRatio =
    elapsedSeconds === undefined || projectedSeconds === undefined || projectedSeconds <= 0
      ? undefined
      : elapsedSeconds / projectedSeconds;
  const timeProgress =
    timeRatio === undefined || !Number.isFinite(timeRatio)
      ? "?"
      : `${formatProgressBar(timeRatio)} ${elapsed} / ${projectedDuration}`;

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
    !st.done && st.stopped
      ? ORANGE
      : !st.done && !anyFailures && st.gcDetected
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
  lines.push(
    `${label("Projected:")}       ${val(`${projectedDuration} duration, ${projectedEndTime} end`)}`,
  );
  lines.push(
    `${label("Tests:")}           ${val(`${formatProgressBar(testsRatio)} ${testsProgress || "?"}`)}`,
  );
  lines.push(`${label("Time:")}            ${val(timeProgress)}`);
  lines.push(
    `${label("Completion rate:")} ${val(`${formatRate(st.completionRateAvgPerMinute)} total avg, ${formatRate(st.completionRateRecentPerMinute)} recent avg`)}`,
  );
  if (st.passGroups && st.passGroups.length > 0) {
    lines.push(`${label("Pass groups:")}`);
    const widths = {
      name: Math.max(...st.passGroups.map((group) => group.name.length)),
      progress: Math.max(
        ...st.passGroups.map((group) => {
          if (group.completed === undefined || group.targetCount === undefined) return 1;
          return `${group.completed}/${group.targetCount}`.length;
        }),
      ),
      state: Math.max(
        ..."pending running failed done".split(" ").map((state) => state.length),
        ...st.passGroups.map((group) =>
          group.done && (group.fail > 0 || group.fatal > 0 || group.buildFailure > 0)
            ? "failed".length
            : group.done
              ? "done".length
              : group.active
                ? "running".length
                : "pending".length,
        ),
      ),
    };
    for (const group of st.passGroups) {
      lines.push(`  ${val(formatPassGroupProgress(group, widths))}`);
    }
  }
  lines.push(
    `${label(st.done ? "Tests finished:" : st.stopped ? "Tests stopped:" : "Tests so far:")}`,
  );
  lines.push(`  ${val(`Pass:          ${st.pass}`)}`);
  lines.push(`  ${val(`Fail:          ${st.fail}`)}`);
  lines.push(`  ${val(`Fatal:         ${st.fatal}`)}`);
  lines.push(`  ${val(`Skip:          ${st.skip}`)}`);
  lines.push(`  ${val(`Build failure: ${st.buildFailure}`)}`);
  lines.push(`${label("----------------------")}`);
  lines.push(`${label("Tests remaining:")} ${val(remaining)}`);
  if (st.stopped) {
    lines.push(`${label("Run stopped:")} ${val(st.stopReason || "yes")}`);
  }
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

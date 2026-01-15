function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, "");
}

function parseBuck2DurationSecFromSuffix(s: string): number | null {
  const raw = String(s || "").trim();
  // 296120.4ms
  if (raw.endsWith("ms")) {
    const n = Number(raw.slice(0, -2));
    return Number.isFinite(n) && n >= 0 ? n / 1000 : null;
  }
  // 36.9s
  if (raw.endsWith("s")) {
    const inner = raw.slice(0, -1);
    // 2:33.1s
    if (inner.includes(":")) {
      const [mm, ss] = inner.split(":", 2);
      const m = Number(mm);
      const s = Number(ss);
      if (!Number.isFinite(m) || !Number.isFinite(s) || m < 0 || s < 0) return null;
      return m * 60 + s;
    }
    const n = Number(inner);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

export type Buck2Completion = {
  status: "pass" | "fail" | "skip";
  target: string;
  durationSec: number;
  rawDuration: string;
};

function parseBuck2CompletionFromLine(line: string): Buck2Completion | null {
  // Examples:
  // [2026-01-14T21:57:39.821-06:00] ✓ Pass: root//:target (45.4s)
  // [..] ✗ Fail: root//:target (12.3s)
  // [..] Skip: root//:target (0.1s)
  const m = /^\[[^\]]+\]\s+(✓ Pass:|✗ Fail:|Skip:)\s+(\S+)\s+\(([^)]+)\)\s*$/.exec(line.trim());
  if (!m) return null;
  const head = String(m[1] || "");
  const status: Buck2Completion["status"] = head.includes("Pass")
    ? "pass"
    : head.includes("Fail")
      ? "fail"
      : "skip";
  const target = String(m[2] || "").trim();
  const rawDuration = String(m[3] || "").trim();
  const durationSec = parseBuck2DurationSecFromSuffix(rawDuration);
  if (!target || durationSec === null) return null;
  return { status, target, durationSec, rawDuration };
}

export function parseBuck2ProgressFromLines(
  chunk: string,
  carry: string,
): { pass: number; fail: number; completions: Buck2Completion[]; carry: string } {
  // Buck writes output in arbitrary chunk boundaries; keep a carry buffer for incomplete lines.
  const joined = carry + chunk;
  const parts = joined.split("\n");
  const complete = parts.slice(0, -1);
  const nextCarry = parts[parts.length - 1] ?? "";

  let pass = 0;
  let fail = 0;
  const completions: Buck2Completion[] = [];
  for (const rawLine of complete) {
    const line = stripAnsi(rawLine);
    if (/^\[[^\]]+\] ✓ Pass:/.test(line)) pass++;
    else if (/^\[[^\]]+\] ✗ Fail:/.test(line)) fail++;
    const c = parseBuck2CompletionFromLine(line);
    if (c) completions.push(c);
  }
  return { pass, fail, completions, carry: nextCarry };
}

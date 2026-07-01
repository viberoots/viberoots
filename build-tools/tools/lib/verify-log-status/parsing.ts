function parseLineForMatching(line: string): { normalized: string; isComment: boolean } {
  let s = line.trim();
  // Strip common buck2 log prefix: [2025-...]
  // Important: do NOT strip non-timestamp bracketed prefixes like "[verify] ...".
  if (/^\[\d{4}-\d{2}-\d{2}T/.test(s)) {
    const end = s.indexOf("]");
    if (end > 0) s = s.slice(end + 1).trim();
  }
  const isComment = s.startsWith("#");
  if (isComment) s = s.slice(1).trim();
  return { normalized: s, isComment };
}

export function parseRemaining(lines: string[]): number | undefined {
  // Best-effort extraction from buck2 output.
  // Examples seen in the wild:
  // - "Loading targets. Remaining ...", "Loading targets. Remaining: 123"
  // - "Remaining: 12"
  // - A block like:
  //     Waiting on Test A -- ...
  //     Waiting on Test B -- ...
  //     Waiting on Test C -- ..., and 9 other actions
  //   In this case: remaining = (9 other actions) + (3 explicitly listed actions) = 12
  const re = /\bRemaining:?\s+(\d+)\b/;
  const waitingWithOthersRe = /^\s*Waiting on\b.*\band\s+(\d+)\s+other actions\b/;
  const waitingLineRe = /^\s*Waiting on\b/;

  for (let i = lines.length - 1; i >= 0; i--) {
    const { normalized } = parseLineForMatching(lines[i]);
    const w = waitingWithOthersRe.exec(normalized);
    if (w) {
      const other = Number(w[1]);
      if (!Number.isFinite(other)) continue;
      // Count how many "Waiting on ..." lines are part of this same status block.
      let listed = 1;
      for (let j = i - 1; j >= 0; j--) {
        const prev = parseLineForMatching(lines[j]).normalized;
        if (!waitingLineRe.test(prev)) break;
        // Stop if we hit another "and N other actions" line (newer block boundary).
        if (waitingWithOthersRe.test(prev)) break;
        listed++;
      }
      return Math.max(0, other) + listed;
    }

    const m = re.exec(normalized);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

export function collectFailedLabels(lines: string[]): string[] {
  const failAltRe = /(?:^|\s)Fail:\s*(.+)$/;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const { normalized: line, isComment } = parseLineForMatching(raw);
    if (isComment) continue;
    if (line.startsWith("[verify] failure diagnostics ")) continue;
    let m: RegExpExecArray | null = null;
    const markerIdx = line.indexOf("✗ Fail:");
    const markerLabel =
      markerIdx >= 0 && (markerIdx === 0 || /\s/.test(line[markerIdx - 1] || ""))
        ? line.slice(markerIdx + "✗ Fail:".length).trim()
        : "";
    const rawLabel = markerLabel || ((m = failAltRe.exec(line)) ? m[1] || "" : "");
    if (rawLabel) {
      const label = rawLabel.replace(/\s+\([^)]*\)\s*$/, "").trim();
      const key = label || line;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(label || line);
    }
  }
  return out;
}

export function parseFinalFailedTargetsBlock(lines: string[]): string[] {
  // Prefer the final buck2 failure list if present, e.g.:
  //   1 TESTS FAILED
  //     ✗ root//:some_test
  //     ✗ root//:another_test
  const tail = lines.slice(Math.max(0, lines.length - 400));
  let startIdx = -1;
  for (let i = tail.length - 1; i >= 0; i--) {
    const { normalized, isComment } = parseLineForMatching(tail[i]);
    if (isComment) continue;
    if (/\bTESTS FAILED\b/.test(normalized)) {
      startIdx = i;
      break;
    }
  }
  if (startIdx < 0) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  const itemRe = /^\s*✗\s+(.+)\s*$/;
  for (let i = startIdx + 1; i < tail.length; i++) {
    const { normalized, isComment } = parseLineForMatching(tail[i]);
    if (isComment) continue;
    const m = itemRe.exec(normalized);
    if (!m) continue;
    const t = (m[1] || "").trim();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export function findLastFullSuiteWindowStart(lines: string[]): number {
  // Best-effort: prefer the full-run marker so timing analysis includes pre-buck phases.
  for (let i = lines.length - 1; i >= 0; i--) {
    const { normalized } = parseLineForMatching(lines[i]);
    if (normalized.startsWith("[verify] begin iso=")) return i;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const { normalized } = parseLineForMatching(lines[i]);
    if (normalized.startsWith("[verify] buck2 test begin iso=")) return i;
  }
  // Fallback: look for a stable header block from the full-suite buck2 test:
  //   Loading targets. Remaining ...
  for (let i = lines.length - 1; i >= 0; i--) {
    const { normalized } = parseLineForMatching(lines[i]);
    if (normalized.startsWith("Loading targets.")) return i;
  }
  return 0;
}

export function parseBuck2ExitMarker(lines: string[]): {
  done: boolean;
  exitCode?: number;
  endSec?: number;
} {
  // [verify] buck2 test exit iso=v-123 status=0 end_s=1735251111
  const re = /^\[verify\]\s+buck2 test exit iso=.*\s+status=(\d+)(?:\s+end_s=(\d+))?/;
  for (let i = lines.length - 1; i >= 0; i--) {
    const { normalized } = parseLineForMatching(lines[i]);
    const m = re.exec(normalized);
    if (m) {
      const code = Number(m[1]);
      const end = m[2] ? Number(m[2]) : undefined;
      return {
        done: true,
        exitCode: Number.isFinite(code) ? code : undefined,
        endSec: end !== undefined && Number.isFinite(end) && end > 0 ? end : undefined,
      };
    }
  }
  return { done: false };
}

export function parseVerifyStoppedMarker(lines: string[]): {
  stopped: boolean;
  endSec?: number;
  reason?: string;
} {
  const re = /^\[verify\]\s+stopped\b(?:\s+reason=(\S+))?(?:\s+signal=(\S+))?(?:\s+end_s=(\d+))?/;
  for (let i = lines.length - 1; i >= 0; i--) {
    const { normalized } = parseLineForMatching(lines[i]);
    const m = re.exec(normalized);
    if (!m) continue;
    const end = m[3] ? Number(m[3]) : undefined;
    return {
      stopped: true,
      endSec: end !== undefined && Number.isFinite(end) && end > 0 ? end : undefined,
      reason: m[1] || (m[2] ? `signal:${m[2]}` : undefined),
    };
  }
  return { stopped: false };
}

export function parseVerifyBeginEpochSec(lines: string[]): number | undefined {
  // Prefer the earliest verify-run start marker when available so elapsed includes
  // preflight/setup time before buck2 test execution begins.
  const res = [/^\[verify\]\s+begin iso=.*\s+start_s=(\d+)/];
  const fallbackRes = [/^\[verify\]\s+buck2 test begin iso=.*\s+start_s=(\d+)/];
  for (const re of res) {
    for (const raw of lines) {
      const { normalized } = parseLineForMatching(raw);
      const m = re.exec(normalized);
      if (m) {
        const s = Number(m[1]);
        if (Number.isFinite(s) && s > 0) return s;
      }
    }
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const { normalized } = parseLineForMatching(lines[i]);
    for (const re of fallbackRes) {
      const m = re.exec(normalized);
      if (m) {
        const s = Number(m[1]);
        if (Number.isFinite(s) && s > 0) return s;
      }
    }
  }
  return undefined;
}

export function parseGcDetected(lines: string[]): boolean {
  for (let i = lines.length - 1; i >= 0; i--) {
    const { normalized } = parseLineForMatching(lines[i]);
    if (normalized.includes("[verify] nix gc preflight warning:")) return true;
    if (normalized.includes("[verify] safety-rails notice: active nix gc process detected")) {
      return true;
    }
  }
  return false;
}

export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}:${String(remMins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function parseLineFromBuckLogForMatching(line: string): {
  normalized: string;
  isComment: boolean;
} {
  return parseLineForMatching(line);
}

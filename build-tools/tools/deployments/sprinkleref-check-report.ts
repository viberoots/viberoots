#!/usr/bin/env zx-wrapper
import type { SprinkleRefCheckEntry, SprinkleRefCheckReport } from "./sprinkleref-check-types";

const ORDER = ["present", "declared", "missing", "unmapped", "invalid", "unchecked"];
const ACTIONABLE = new Set(["missing", "unmapped"]);

export function summarize(entries: SprinkleRefCheckEntry[]): Record<string, number> {
  return Object.fromEntries(
    ORDER.map((status) => [status, entries.filter((e) => e.status === status).length]),
  );
}

export function exitCodeFor(report: SprinkleRefCheckReport): number {
  return report.refs.some((entry) => ["missing", "unmapped"].includes(entry.status)) ? 1 : 0;
}

export function renderReport(report: SprinkleRefCheckReport): string {
  const lines = [
    report.target ? `SprinkleRef check for ${report.target}` : "SprinkleRef check",
    report.target ? `Deps: ${report.deps}` : `Scanned files: ${report.scannedFiles}`,
    `Refs found: ${report.refs.length}`,
    `Summary: ${ORDER.map((status) => `${status} ${report.summary[status] || 0}`).join(", ")}`,
    "",
  ];
  if (report.target) return renderTargetReport(report, lines);
  renderActionableGroup(lines, report.refs);
  renderUncheckedHint(lines, report.summary.unchecked || 0);
  return lines.join("\n").trimEnd();
}

function renderTargetReport(report: SprinkleRefCheckReport, lines: string[]): string {
  for (const [label, scope] of [
    ["Direct refs", "direct"],
    ["From dependencies", "dependency"],
  ] as const) {
    const scoped = actionable(report.refs.filter((entry) => entry.scope === scope));
    if (scoped.length === 0) continue;
    lines.push(label);
    renderActionableGroup(lines, scoped, "  ");
    lines.push("");
  }
  if (actionable(report.refs).length === 0) renderActionableGroup(lines, []);
  renderUncheckedHint(lines, report.summary.unchecked || 0);
  return lines.join("\n").trimEnd();
}

function renderActionableGroup(
  lines: string[],
  entries: SprinkleRefCheckEntry[],
  prefix = "",
): void {
  const actionableEntries = actionable(entries);
  if (actionableEntries.length === 0) {
    lines.push(`${prefix}No checked missing or unmapped refs.`);
    lines.push("");
    return;
  }
  lines.push(`${prefix}Action required`);
  for (const entry of actionableEntries) lines.push(renderEntry(entry, prefix));
  lines.push("");
}

function actionable(entries: SprinkleRefCheckEntry[]): SprinkleRefCheckEntry[] {
  return entries.filter((entry) => ACTIONABLE.has(entry.status));
}

function renderEntry(entry: SprinkleRefCheckEntry, prefix: string): string {
  const details = [
    entry.category ? `category ${entry.category}` : "",
    entry.backend ? `backend ${entry.backend}` : "",
    entry.source ? `source ${entry.source}` : "",
    entry.reason ? `reason ${entry.reason}` : "",
    entry.requiredBy.length ? `required by ${entry.requiredBy.join(", ")}` : "",
  ].filter(Boolean);
  return `${prefix}  ${entry.status} ${entry.ref}${details.length ? ` (${details.join("; ")})` : ""}`;
}

function renderUncheckedHint(lines: string[], count: number): void {
  if (count === 0) return;
  lines.push(
    `Unchecked secrets: ${count} (run build-tools/tools/deployments/infisical-bootstrap.ts repo --dry-run, build-tools/tools/deployments/infisical-bootstrap.ts repo --yes, or sprinkleref --init sprinkleref; then pass --config to determine whether they are present or missing).`,
  );
}

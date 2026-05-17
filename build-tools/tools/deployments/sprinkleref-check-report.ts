#!/usr/bin/env zx-wrapper
import type { SprinkleRefCheckEntry, SprinkleRefCheckReport } from "./sprinkleref-check-types";

const ORDER = ["present", "declared", "missing", "unmapped", "invalid", "unchecked"];

export function summarize(entries: SprinkleRefCheckEntry[]): Record<string, number> {
  return Object.fromEntries(
    ORDER.map((status) => [status, entries.filter((e) => e.status === status).length]),
  );
}

export function exitCodeFor(report: SprinkleRefCheckReport): number {
  return report.refs.some((entry) => ["missing", "unmapped", "invalid"].includes(entry.status))
    ? 1
    : 0;
}

export function renderReport(report: SprinkleRefCheckReport): string {
  const lines = [
    report.target ? `SprinkleRef check for ${report.target}` : "SprinkleRef check",
    report.target ? `Deps: ${report.deps}` : `Scanned files: ${report.scannedFiles}`,
    `Refs found: ${report.refs.length}`,
    "",
  ];
  if (report.target) return renderTargetReport(report, lines);
  for (const status of ORDER) {
    const entries = report.refs.filter((entry) => entry.status === status);
    if (entries.length === 0) continue;
    lines.push(title(status));
    for (const entry of entries) lines.push(...renderEntry(entry));
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function renderTargetReport(report: SprinkleRefCheckReport, lines: string[]): string {
  for (const [label, scope] of [
    ["Direct refs", "direct"],
    ["From dependencies", "dependency"],
  ] as const) {
    const scoped = report.refs.filter((entry) => entry.scope === scope);
    if (scoped.length === 0) continue;
    lines.push(label);
    for (const status of ORDER) {
      const entries = scoped.filter((entry) => entry.status === status);
      if (entries.length === 0) continue;
      lines.push(`  ${title(status)}`);
      for (const entry of entries) {
        lines.push(...renderEntry(entry).map((line) => `  ${line}`));
      }
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function renderEntry(entry: SprinkleRefCheckEntry): string[] {
  const lines = [`  ${entry.ref}`, `    scope: ${entry.scope}`];
  if (entry.category) lines.push(`    category: ${entry.category}`);
  if (entry.backend) lines.push(`    backend: ${entry.backend}`);
  if (entry.source) lines.push(`    source: ${entry.source}`);
  if (entry.reason) lines.push(`    reason: ${entry.reason}`);
  for (const requiredBy of entry.requiredBy) lines.push(`    required by ${requiredBy}`);
  for (const location of entry.locations) lines.push(`    location: ${location}`);
  return lines;
}

function title(status: string): string {
  if (status === "present" || status === "declared") return "OK";
  return status[0].toUpperCase() + status.slice(1);
}

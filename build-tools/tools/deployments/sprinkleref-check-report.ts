#!/usr/bin/env zx-wrapper
import type { SprinkleRefCheckEntry, SprinkleRefCheckReport } from "./sprinkleref-check-types";
import { formatProjectConfigOverride } from "./project-config";

const ORDER = ["present", "declared", "managed", "missing", "unmapped", "invalid", "unchecked"];
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
  renderLocalOverrides(lines, report.localOverrides || []);
  if (report.target) return renderTargetReport(report, lines);
  renderActionableGroup(lines, report.refs);
  renderManagedGroup(lines, report.refs);
  renderUncheckedHint(lines, report.summary.unchecked || 0);
  return lines.join("\n").trimEnd();
}

function renderLocalOverrides(
  lines: string[],
  overrides: NonNullable<SprinkleRefCheckReport["localOverrides"]>,
): void {
  if (overrides.length === 0) return;
  lines.push("Active local overrides:");
  for (const override of overrides) lines.push(`  ${formatProjectConfigOverride(override)}`);
  lines.push("");
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
  renderManagedGroup(lines, report.refs);
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
  lines.push(`${prefix}Missing values:`);
  for (const group of groupEntries(actionableEntries)) {
    lines.push(...renderGroupHeading(group, prefix));
    for (const entry of group.entries) lines.push(...renderEntry(entry, `${prefix}  `));
  }
  lines.push("");
}

function actionable(entries: SprinkleRefCheckEntry[]): SprinkleRefCheckEntry[] {
  return entries.filter((entry) => ACTIONABLE.has(entry.status));
}

function renderManagedGroup(lines: string[], entries: SprinkleRefCheckEntry[]): void {
  const managedEntries = entries.filter((entry) => entry.status === "managed");
  if (managedEntries.length === 0) return;
  lines.push("Managed bootstrap outputs:");
  for (const group of groupManagedEntries(managedEntries)) {
    lines.push(`  family: ${group.family}`);
    lines.push(`    managed by: ${group.managedBy}`);
    for (const entry of group.entries) lines.push(`      ${entry.ref}`);
  }
  lines.push("");
}

function groupManagedEntries(entries: SprinkleRefCheckEntry[]): ManagedEntryGroup[] {
  const groups = new Map<string, ManagedEntryGroup>();
  for (const entry of entries) {
    const family = entry.managedFamily || "unknown";
    const managedBy = entry.managedBy || "bootstrap";
    const key = `${family}\0${managedBy}`;
    const group = groups.get(key) || { family, managedBy, entries: [] };
    group.entries.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()];
}

type ManagedEntryGroup = {
  family: string;
  managedBy: string;
  entries: SprinkleRefCheckEntry[];
};

type EntryGroup = {
  category?: string;
  backend?: string;
  project?: string;
  projectName?: string;
  deploymentFamily?: string;
  environments: Set<string>;
  entries: RenderEntry[];
};

type RenderEntry = {
  ref: string;
  source?: string;
  reason?: string;
  requiredBy: string[];
};

function groupEntries(entries: SprinkleRefCheckEntry[]): EntryGroup[] {
  const groups = new Map<string, EntryGroup>();
  for (const entry of entries) {
    const parsed = parseInfisicalBackend(entry.backend);
    const key = JSON.stringify({
      category: entry.category,
      backend: parsed ? "infisical" : entry.backend,
      project: parsed?.project,
      projectName: parsed?.projectName,
      deploymentFamily: entry.deploymentFamily,
    });
    const group =
      groups.get(key) ||
      ({
        category: entry.category,
        backend: parsed ? "infisical" : entry.backend,
        project: parsed?.project,
        projectName: parsed?.projectName,
        deploymentFamily: entry.deploymentFamily,
        environments: new Set<string>(),
        entries: [],
      } satisfies EntryGroup);
    if (parsed?.environment) group.environments.add(parsed.environment);
    addRenderEntry(group.entries, entry);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function renderGroupHeading(group: EntryGroup, prefix: string): string[] {
  const backend = group.backend ? ` (${group.backend})` : "";
  const lines = [`${prefix}  category: ${group.category || "unmapped"}${backend}`];
  if (group.deploymentFamily) lines.push(`${prefix}    family: ${group.deploymentFamily}`);
  if (group.project) lines.push(`${prefix}    project: ${renderProject(group)}`);
  const environments = [...group.environments].sort();
  if (environments.length) lines.push(`${prefix}      environment: ${environments.join(", ")}`);
  return lines;
}

function addRenderEntry(entries: RenderEntry[], entry: SprinkleRefCheckEntry): void {
  const current = entries.find(
    (candidate) =>
      candidate.ref === entry.ref &&
      candidate.source === entry.source &&
      candidate.reason === entry.reason,
  );
  if (!current) {
    entries.push({
      ref: entry.ref,
      source: entry.source,
      reason: entry.reason,
      requiredBy: entry.requiredBy,
    });
    return;
  }
  current.requiredBy = [...new Set([...current.requiredBy, ...entry.requiredBy])];
}

function renderProject(group: EntryGroup): string {
  if (!group.projectName) return group.project || "";
  return `${group.projectName} (${group.project})`;
}

function renderEntry(entry: RenderEntry, prefix: string): string[] {
  const details = [
    entry.source && entry.source !== "secret_requirements" ? `source ${entry.source}` : "",
    entry.reason ? `reason ${entry.reason}` : "",
  ].filter(Boolean);
  const lines = [`${prefix}      ${entry.ref}`];
  if (details.length) lines.push(`${prefix}        ${details.join("; ")}`);
  if (entry.requiredBy.length) {
    lines.push(`${prefix}        required by:`);
    for (const target of entry.requiredBy) lines.push(`${prefix}          ${target}`);
  }
  return lines;
}

function parseInfisicalBackend(backend?: string) {
  const match = backend?.match(/^infisical project (.+?)(?: \((.+)\))? environment (.+)$/);
  return match ? { project: match[1], projectName: match[2], environment: match[3] } : undefined;
}

function renderUncheckedHint(lines: string[], count: number): void {
  if (count === 0) return;
  lines.push(
    `Unchecked secrets: ${count} (pass --config, set SPRINKLEREF_CONFIG, or run repo bootstrap to create projects/config/shared.json before checking backend presence).`,
  );
}

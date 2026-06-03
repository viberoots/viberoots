import path from "node:path";
import { getFlagStr } from "../lib/cli";
import { LOCAL_VALUES_PATH, type StackInputSource } from "./aws-account-inputs";
import type {
  AwsAccountConfig,
  AwsAccountStatus,
  MissingConfigField,
  Phase,
  PhaseState,
} from "./aws-account-types";
import { relativePath } from "./aws-account-utils";

export function formatMissingDestinations(fields: MissingConfigField[]): string[] {
  const lines = ["Missing Values"];
  const localOrShared = fields.filter(
    (field) => (field.destination || "stack-config") === "local-values-or-shared-resolver",
  );
  if (localOrShared.length > 0) {
    lines.push(
      "  Local values or shared resolver:",
      "    Local file:",
      `      ${LOCAL_VALUES_PATH}`,
      "    Shared resolver:",
      "      selected SprinkleRef default/category chain",
    );
    for (const field of localOrShared) lines.push(...formatMissingField(field));
  }
  const bootstrap = fields.filter((field) => field.destination === "bootstrap-category");
  if (bootstrap.length > 0) {
    lines.push("  Bootstrap category:");
    for (const field of bootstrap) lines.push(...formatMissingField(field));
  }
  const stackConfig = fields.filter(
    (field) => !field.destination || field.destination === "stack-config",
  );
  if (stackConfig.length > 0) {
    lines.push("  Stack config:", `    Edit ${stackConfigPathForSummary()} and fill:`);
    for (const field of stackConfig) {
      const valueHint = field.valueHint.trim().startsWith("{")
        ? field.valueHint
        : `"${field.valueHint}"`;
      lines.push(`    "${field.field}": ${valueHint}`);
    }
  }
  const notes = fields.filter((field) => field.note);
  if (notes.length > 0) {
    lines.push("  Notes:");
    for (const field of notes) lines.push(...wrapText(`${field.field}: ${field.note}`, 4));
  }
  return lines;
}

function formatMissingField(field: MissingConfigField): string[] {
  const lines = [`    ${field.field}:`];
  if (field.ref) lines.push(...wrapText(field.ref, 6, "ref: "));
  const hint = field.valueHint.trim().startsWith("{") ? field.valueHint : field.valueHint;
  if (hint && (!field.ref || !hint.includes(field.ref))) {
    lines.push(...wrapText(hint, 6, "value: "));
  }
  return lines;
}

export function formatInputSources(status: AwsAccountStatus, config: AwsAccountConfig): string[] {
  const phaseSources = Object.values(status.phases).flatMap((phase) =>
    Object.entries(phase.resolvedInputSources || {}),
  );
  const resolvedSources = new Map<string, StackInputSource>(phaseSources);
  return [
    "awsAccountId",
    "awsOrganizationId",
    "supabaseOrgId",
    "supabaseProjectRef",
    "supabaseAccessToken",
  ].flatMap((field) => {
    const source = resolvedSources.get(field) || config.inputSources[field];
    return formatInputSource(field, source);
  });
}

function formatInputSource(field: string, source?: StackInputSource): string[] {
  if (!source) return [`  ${field}: missing`];
  const visibility =
    source.source === "missing" && !source.valuePrinted
      ? " (secret)"
      : source.valuePrinted
        ? ""
        : " (redacted)";
  const lines = [`  ${field}: ${displayInputSource(source.source)}${visibility}`];
  if (source.env) lines.push(`    env: ${source.env}`);
  if (source.ref) lines.push(...wrapText(source.ref, 4, "ref: "));
  if (source.category) lines.push(`    category: ${source.category}`);
  if (source.localValuesPath) {
    lines.push(
      ...wrapText(relativePath(process.cwd(), source.localValuesPath), 4, "local-values: "),
    );
  }
  if (source.backend) lines.push(...wrapText(source.backend, 4, "backend: "));
  return lines;
}

function displayInputSource(source: StackInputSource["source"]): string {
  if (source === "cli") return "command line";
  if (source === "inline") return "stack config";
  if (source === "default") return "default";
  if (source === "local-values") return "local values";
  if (source === "sprinkleref") return "SprinkleRef";
  if (source === "env") return "environment";
  return "missing";
}

export function collectMissingConfigFields(
  problemPhases: Phase[],
  status: AwsAccountStatus,
): MissingConfigField[] {
  const fields = new Map<string, MissingConfigField>();
  for (const phase of problemPhases) {
    for (const field of status.phases[phase]?.missingConfigFields || []) {
      if (!fields.has(field.field)) fields.set(field.field, field);
    }
  }
  return [...fields.values()];
}

function stackConfigPathForSummary(): string {
  return getFlagStr("config", "").trim() || "config/control-plane/stack.json";
}

export function awsAccountCheckCommand(status: AwsAccountStatus, json: boolean): string {
  const args = ["control-plane", "aws-account", "check", ...awsAccountContextArgs(status)];
  if (json) args.push("--json");
  return args.join(" ");
}

export function awsAccountBootstrapCommand(status: AwsAccountStatus): string {
  return ["control-plane", "aws-account", "bootstrap", ...awsAccountContextArgs(status)].join(" ");
}

function awsAccountContextArgs(status: AwsAccountStatus): string[] {
  const configPath = getFlagStr("config", "").trim();
  if (configPath) return ["--config", configPath];
  const evidenceDir = getFlagStr("evidence-dir", "").trim();
  if (evidenceDir) return ["--evidence-dir", status.evidenceDir];
  const domain = getFlagStr("domain", "").trim();
  if (domain) return ["--domain", domain];
  return [];
}

export function phaseStateLabel(state: PhaseState): string {
  if (state === "passed") return "PASS";
  if (state === "blocked") return "BLOCKED";
  if (state === "failed") return "FAILED";
  if (state === "manual") return "MANUAL";
  return "PENDING";
}

export function wrapText(text: string, indent: number, prefix = ""): string[] {
  const width = 88;
  const pad = " ".repeat(indent);
  const firstPrefix = `${pad}${prefix}`;
  const nextPrefix = " ".repeat(firstPrefix.length);
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = firstPrefix;
  for (const word of words) {
    if (current === firstPrefix || current === nextPrefix) {
      current = `${current}${word}`;
    } else if (current.trim() && current.length + word.length + 1 > width) {
      lines.push(current.trimEnd());
      current = `${nextPrefix}${word}`;
    } else {
      current = current.trim() ? `${current} ${word}` : `${current}${word}`;
    }
  }
  if (current.trim()) lines.push(current.trimEnd());
  return lines;
}

import process from "node:process";

type OverrideMap = Record<string, string>;

function isCi(): boolean {
  try {
    return String(process.env.CI || "").trim() === "true";
  } catch {
    return false;
  }
}

function warnActive(envName: string, size: number) {
  if (size <= 0) return;
  try {
    // Match wording used across docs/templates for consistency
    console.warn(
      `[OVERRIDES ACTIVE] ${envName} is set — local derivations will differ. Unset before CI or sharing cache artifacts.`,
    );
  } catch {}
}

export function readOverrideMap(envName: string): OverrideMap {
  const raw = String(process.env[envName] || "");
  if (!raw.trim()) return {};
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? (obj as OverrideMap) : {};
  } catch {
    return {};
  }
}

export function writeOverrideMap(envName: string, map: OverrideMap): void {
  const keys = Object.keys(map);
  if (isCi() && keys.length > 0) {
    throw new Error(`Dev overrides are forbidden in CI (${envName} is set)`);
  }
  (process.env as any)[envName] = JSON.stringify(map);
  warnActive(envName, keys.length);
}

export function setOverride(envName: string, key: string, valuePath: string): void {
  const cur = readOverrideMap(envName);
  cur[key] = valuePath;
  writeOverrideMap(envName, cur);
}

export function clearOverride(envName: string, key: string): void {
  const cur = readOverrideMap(envName);
  if (key in cur) {
    delete cur[key];
  }
  writeOverrideMap(envName, cur);
}

export function formatExportSnippet(envName: string, map: OverrideMap): string {
  return `export ${envName}='${JSON.stringify(map)}'`;
}

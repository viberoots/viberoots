import * as fsp from "node:fs/promises";

type GraphRecord = Record<string, unknown>;

function isRecord(value: unknown): value is GraphRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeTargetLabel(label: string): string {
  const noConfig = label.replace(/\s+\(.*\)$/, "");
  const idx = noConfig.indexOf("//");
  return idx >= 0 ? `//${noConfig.slice(idx + 2)}` : noConfig;
}

function normalizeNixAttr(attr: string): string {
  const value = String(attr || "")
    .trim()
    .toLowerCase();
  if (!value) return "";
  const prefixed = value.startsWith("pkgs.") ? value : `pkgs.${value}`;
  return prefixed === "pkgs.gtest" ? "pkgs.googletest" : prefixed;
}

function normalizeNixpkgsProfile(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "default";
}

function sourcePlansFromGraph(raw: unknown) {
  const nodes = Array.isArray(raw)
    ? raw.filter(isRecord)
    : isRecord(raw) && Array.isArray(raw.nodes)
      ? raw.nodes.filter(isRecord)
      : [];
  return nodes.flatMap((node) => {
    const target = normalizeTargetLabel(String(node.name || "").trim());
    if (!target) return [];
    const rawPins = isRecord(node.nixpkg_pins) ? node.nixpkg_pins : {};
    const nixpkg_pins = Object.fromEntries(
      Object.entries(rawPins).flatMap(([attr, rawPin]) => {
        if (!isRecord(rawPin)) return [];
        const normalizedAttr = normalizeNixAttr(attr);
        if (!normalizedAttr) return [];
        return [
          [normalizedAttr, { nixpkgs_profile: normalizeNixpkgsProfile(rawPin.nixpkgs_profile) }],
        ];
      }),
    );
    return [
      { target, nixpkgs_profile: normalizeNixpkgsProfile(node.nixpkgs_profile), nixpkg_pins },
    ];
  });
}

export async function sourcePlanEvidenceFromGraphFile(file: string): Promise<unknown[]> {
  if (!file) return [];
  try {
    return sourcePlansFromGraph(JSON.parse(await fsp.readFile(file, "utf8")));
  } catch {
    return [];
  }
}

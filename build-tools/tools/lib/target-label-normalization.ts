export function dropConfigSuffix(label: string): string {
  return String(label || "").split(" (")[0];
}

export function dropCellPrefix(label: string): string {
  const value = String(label || "");
  if (value.startsWith("//")) return value;
  const index = value.indexOf("//");
  return index >= 0 ? `//${value.slice(index + 2)}` : value;
}

export function normalizeTargetLabel(label: string): string {
  return dropCellPrefix(dropConfigSuffix(label));
}

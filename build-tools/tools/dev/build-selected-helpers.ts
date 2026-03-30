export function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, "");
}

export function targetPackageFromLabel(target: string): string {
  const t = String(target || "").trim();
  const noCell = t.startsWith("root//") ? t.slice("root//".length - 2) : t;
  if (!noCell.startsWith("//")) return "";
  const body = noCell.slice(2);
  const idx = body.indexOf(":");
  return idx >= 0 ? body.slice(0, idx) : body;
}

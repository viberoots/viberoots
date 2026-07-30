const DNS_SEGMENT = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function tauriBundleIdentifier(name: string): string {
  const segment = String(name || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!segment) {
    throw new Error("Tauri scaffold name must contain an ASCII letter or digit");
  }
  if (!DNS_SEGMENT.test(segment)) {
    throw new Error(
      "Tauri scaffold name produces an invalid or ambiguous reverse-DNS segment; use at most 63 letters, digits, and hyphens",
    );
  }
  return `dev.viberoots.${segment}`;
}

export function applyTauriScaffoldAnswers(
  language: string,
  template: string,
  data: Record<string, any>,
): void {
  if (language !== "rust" || template !== "tauri-app") return;
  data.tauri_identifier = tauriBundleIdentifier(String(data.name || ""));
}

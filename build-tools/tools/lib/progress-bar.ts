export function formatProgressBar(ratio: number | undefined, width: number): string {
  if (ratio === undefined || !Number.isFinite(ratio)) return `[${"░".repeat(width)}]`;
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

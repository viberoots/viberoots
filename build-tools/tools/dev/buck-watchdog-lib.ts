export function ownerPidForIsolation(iso: string): number | null {
  const s = String(iso || "").trim();
  if (!s) return null;
  // Shared daemon isolations are intentionally long-lived and not owned by a single pid.
  if (/^devbuild-shared-/.test(s)) return null;

  const m = s.match(/^(?:v|zxtest|exporter|devbuild)-(\d+)(?:-|$)/);
  if (!m) return null;
  const pid = Number(m[1]);
  if (!Number.isFinite(pid) || pid <= 1) return null;
  return pid;
}

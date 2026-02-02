import process from "node:process";

export function pidAlive(pid: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    if (e && (e.code === "ESRCH" || e.code === "ENOENT")) return false;
    return true;
  }
}

import process from "node:process";
import {
  processStartSignature as inspectProcessStartSignature,
  processTableLines,
} from "../../lib/process-inspection";

export async function pidAlive(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  const [stat] = await processTableLines({
    psArgs: ["-p", String(pid), "-o", "stat="],
    timeoutMs: 1500,
  });
  return stat ? !stat.includes("Z") : true;
}

export async function pidStartSignature(pid: number): Promise<string> {
  if (!Number.isInteger(pid) || pid <= 0) return "";
  return (await inspectProcessStartSignature(pid)) || "";
}

export async function pidAliveWithSignature(pid: number, expectedSig: string): Promise<boolean> {
  if (!(await pidAlive(pid))) return false;
  if (!expectedSig) return true;
  const signature = await pidStartSignature(pid);
  return Boolean(signature) && signature === expectedSig;
}

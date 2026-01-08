import "./worker-init";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { shSingleQuote } from "./shell-quote";

let buckReaperStateFile: string | null = null;
let buckReaperStarted = false;

async function startSignatureForPid(pid: number, $: any): Promise<string> {
  try {
    const res = await $({
      stdio: "pipe",
      reject: false,
      nothrow: true,
      timeout: 1000,
    })`/bin/ps -p ${pid} -o lstart=`;
    return String(res.stdout || "").trim();
  } catch {
    return "";
  }
}

export async function ensureBuckReaperStarted(tmp: string, $: any): Promise<void> {
  try {
    const shared = String(process.env.BNX_BUCK_REAPER_STATE_FILE || "").trim();
    if (shared) {
      await fsp.appendFile(shared, `${tmp}\n`, "utf8");
      return;
    }
    if (!buckReaperStateFile) {
      const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      buckReaperStateFile = path.join(os.tmpdir(), `bucknix-buck-reaper-${token}.txt`);
    }
    await fsp.appendFile(buckReaperStateFile, `${tmp}\n`, "utf8");

    if (buckReaperStarted) return;
    buckReaperStarted = true;

    const repoRoot = process.cwd();
    const reaper = path.join(repoRoot, "tools", "tests", "lib", "buck-daemon-reaper.ts");
    const parentPid = String(process.pid);
    const parentSig = await startSignatureForPid(process.pid, $);
    if (!parentSig) {
      throw new Error("buck-daemon-reaper: unable to read parent lstart signature via /bin/ps");
    }
    const cmd =
      `zx-wrapper ${reaper} --parent ${parentPid} ` +
      (parentSig ? `--parent-sig ${shSingleQuote(parentSig)} ` : "") +
      `--state-file ${buckReaperStateFile} --poll-ms 1000 >/dev/null 2>&1 & disown`;
    await $({ stdio: "ignore" })`bash --noprofile --norc -c ${cmd}`.nothrow();
  } catch (e) {
    throw e;
  }
}

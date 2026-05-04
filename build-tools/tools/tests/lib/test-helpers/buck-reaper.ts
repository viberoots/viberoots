import "./worker-init";
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { resolveToolPath } from "../../../lib/tool-paths";
import { zxInitPathFromWorkspace } from "./zx-init-probe";

let buckReaperStateFile: string | null = null;
let buckReaperStarted = false;

async function startSignatureForPid(pid: number, $: any): Promise<string> {
  try {
    const psPath = await resolveToolPath("ps");
    const res = await $({
      stdio: "pipe",
      reject: false,
      nothrow: true,
      timeout: 1000,
    })`${psPath} -p ${pid} -o lstart=`;
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
    const reaper = path.join(
      repoRoot,
      "build-tools",
      "tools",
      "tests",
      "lib",
      "buck-daemon-reaper.ts",
    );
    const parentPid = String(process.pid);
    const parentSig = await startSignatureForPid(process.pid, $);
    if (!parentSig) {
      throw new Error("buck-daemon-reaper: unable to read parent lstart signature via ps");
    }
    // Avoid shelling out to `zx-wrapper` here: some environments/tests may not have it on PATH,
    // and non-interactive shells may not support job control (`disown`). Use a detached Node
    // process instead so cleanup is robust even if the test process is SIGKILLed.
    const child = spawn(
      process.execPath,
      [
        "--experimental-top-level-await",
        "--experimental-strip-types",
        "--disable-warning=ExperimentalWarning",
        "--import",
        zxInitPathFromWorkspace(),
        reaper,
        "--parent",
        parentPid,
        "--parent-sig",
        parentSig,
        "--state-file",
        buckReaperStateFile,
        "--poll-ms",
        "1000",
      ],
      {
        cwd: repoRoot,
        stdio: "ignore",
        detached: true,
      },
    );
    child.unref();
  } catch (e) {
    throw e;
  }
}

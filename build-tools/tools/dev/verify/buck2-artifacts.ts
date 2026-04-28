import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { sampleVerifyProcessLines } from "./buck2-failure-diagnostics";

type BuckArtifactFile = {
  path: string;
  bytes: number;
  copied: boolean;
  reason?: string;
};

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "pass";
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(root: string, maxFiles = 400): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    if (out.length >= maxFiles) return;
    let entries: Awaited<ReturnType<typeof fsp.readdir>>;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        out.push(abs);
      }
    }
  }
  await walk(root);
  return out;
}

async function copyIfSmall(
  src: string,
  dst: string,
  maxBytes: number,
  remainingBytes: number,
): Promise<BuckArtifactFile> {
  const stat = await fsp.stat(src);
  const rel = src;
  if (stat.size > maxBytes) {
    return { path: rel, bytes: stat.size, copied: false, reason: "too-large" };
  }
  if (stat.size > remainingBytes) {
    return { path: rel, bytes: stat.size, copied: false, reason: "capture-budget-exceeded" };
  }
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  await fsp.copyFile(src, dst);
  return { path: rel, bytes: stat.size, copied: true };
}

function shouldCaptureFile(file: string): boolean {
  const base = path.basename(file);
  return (
    base === "command_report.json" ||
    base.endsWith("_events.pb.zst") ||
    base.endsWith(".stderr") ||
    base.endsWith(".stdout")
  );
}

export function shouldCaptureBuck2DebugArtifacts(opts: {
  status: number;
  stderrTail: string;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (opts.status === 0) return false;
  const env = opts.env ?? process.env;
  if (String(env.VERIFY_CAPTURE_BUCK_ARTIFACTS || "").trim() === "1") return true;
  if (opts.status !== 32) return true;
  return /Buck daemon event bus|broken pipe/i.test(opts.stderrTail);
}

export async function captureBuck2DebugArtifacts(opts: {
  root: string;
  analysisDir: string | null;
  logFile: string | null;
  passName: string;
  parentIso: string;
  nestedIso: string;
  status: number;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  closeCode: number | null;
  closeSignal: NodeJS.Signals | null;
  buckArgs: string[];
  stdoutTail: string;
  stderrTail: string;
}): Promise<void> {
  if (!opts.analysisDir) return;
  const captureRoot = path.join(opts.analysisDir, "buck2-artifacts", safeName(opts.passName));
  const manifest: {
    passName: string;
    status: number;
    exitCode: number | null;
    exitSignal: NodeJS.Signals | null;
    closeCode: number | null;
    closeSignal: NodeJS.Signals | null;
    parentIso: string;
    nestedIso: string;
    files: BuckArtifactFile[];
  } = {
    passName: opts.passName,
    status: opts.status,
    exitCode: opts.exitCode,
    exitSignal: opts.exitSignal,
    closeCode: opts.closeCode,
    closeSignal: opts.closeSignal,
    parentIso: opts.parentIso,
    nestedIso: opts.nestedIso,
    files: [],
  };

  await fsp.mkdir(captureRoot, { recursive: true }).catch(() => {});
  await fsp
    .writeFile(
      path.join(captureRoot, "buck2-command.json"),
      JSON.stringify({ argv: opts.buckArgs }, null, 2) + "\n",
      "utf8",
    )
    .catch(() => {});
  await fsp
    .writeFile(path.join(captureRoot, "stdout-tail.txt"), opts.stdoutTail, "utf8")
    .catch(() => {});
  await fsp
    .writeFile(path.join(captureRoot, "stderr-tail.txt"), opts.stderrTail, "utf8")
    .catch(() => {});
  const processLines = await sampleVerifyProcessLines(2000).catch(() => null);
  if (processLines) {
    await fsp
      .writeFile(path.join(captureRoot, "process-snapshot.txt"), processLines.join("\n"), "utf8")
      .catch(() => {});
  }

  let copiedBytes = 0;
  const maxCaptureBytes = 200 * 1024 * 1024;
  for (const iso of [opts.parentIso, opts.nestedIso]) {
    const isoRoot = path.join(opts.root, "buck-out", iso);
    if (!(await pathExists(isoRoot))) continue;
    const files = await walkFiles(isoRoot);
    for (const file of files.filter(shouldCaptureFile)) {
      const rel = path.relative(isoRoot, file);
      const dst = path.join(captureRoot, iso, rel);
      try {
        const copied = await copyIfSmall(
          file,
          dst,
          50 * 1024 * 1024,
          Math.max(0, maxCaptureBytes - copiedBytes),
        );
        if (copied.copied) copiedBytes += copied.bytes;
        manifest.files.push(copied);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        manifest.files.push({ path: file, bytes: 0, copied: false, reason: message });
      }
    }
  }

  await fsp
    .writeFile(path.join(captureRoot, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
    .catch(() => {});
  if (opts.logFile) {
    const copied = manifest.files.filter((file) => file.copied).length;
    const skipped = manifest.files.length - copied;
    await fsp
      .appendFile(
        opts.logFile,
        `[verify] buck2 artifact capture pass=${opts.passName} dir=${captureRoot} files=${manifest.files.length} copied=${copied} skipped=${skipped}\n`,
        "utf8",
      )
      .catch(() => {});
  }
}

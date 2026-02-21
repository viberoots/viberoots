#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { normalizeTargetLabel } from "./labels.ts";

export type RunnableExec = {
  argv: string[];
  cwd?: string;
};

export type RunnableContract = {
  kind: string;
  framework?: string;
  run: {
    prod: RunnableExec;
    dev?: RunnableExec;
  };
  runtime?: {
    serverCwd?: string;
    envFiles?: string[];
    nodeArgs?: string[];
  };
  artifacts?: Record<string, unknown>;
};

export type RunnableManifestEntry = {
  label: string;
  kind?: string;
  bins?: string[];
  runnable?: RunnableContract;
};

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || "")).filter(Boolean);
}

function normalizeRunnableContract(v: unknown): RunnableContract | null {
  if (!v || typeof v !== "object") return null;
  const raw = v as any;
  const prod = asStringArray(raw?.run?.prod?.argv);
  if (prod.length === 0) return null;
  const dev = asStringArray(raw?.run?.dev?.argv);
  const envFiles = asStringArray(raw?.runtime?.envFiles);
  const nodeArgs = asStringArray(raw?.runtime?.nodeArgs);
  return {
    kind: String(raw?.kind || "runnable"),
    framework: typeof raw?.framework === "string" ? raw.framework : undefined,
    run: {
      prod: {
        argv: prod,
        cwd: typeof raw?.run?.prod?.cwd === "string" ? raw.run.prod.cwd : undefined,
      },
      ...(dev.length > 0
        ? {
            dev: {
              argv: dev,
              cwd: typeof raw?.run?.dev?.cwd === "string" ? raw.run.dev.cwd : undefined,
            },
          }
        : {}),
    },
    runtime:
      typeof raw?.runtime === "object" && raw.runtime
        ? {
            serverCwd:
              typeof raw?.runtime?.serverCwd === "string" ? raw.runtime.serverCwd : undefined,
            envFiles: envFiles.length > 0 ? envFiles : undefined,
            nodeArgs: nodeArgs.length > 0 ? nodeArgs : undefined,
          }
        : undefined,
    artifacts: raw?.artifacts && typeof raw.artifacts === "object" ? raw.artifacts : undefined,
  };
}

function legacyRunnableFromBins(bins: string[]): RunnableContract | null {
  if (bins.length === 0) return null;
  return {
    kind: "native-bin",
    run: {
      prod: { argv: [bins[0]] },
    },
    artifacts: { bins },
  };
}

export function parseRunnableManifest(text: string): RunnableManifestEntry[] {
  const parsed = JSON.parse(String(text || "[]"));
  if (!Array.isArray(parsed)) return [];
  const out: RunnableManifestEntry[] = [];
  for (const raw of parsed) {
    const label = String((raw as any)?.label || "");
    if (!label) continue;
    const bins = asStringArray((raw as any)?.bins);
    const runnable =
      normalizeRunnableContract((raw as any)?.runnable) || legacyRunnableFromBins(bins);
    out.push({
      label,
      kind: typeof (raw as any)?.kind === "string" ? (raw as any).kind : undefined,
      bins,
      ...(runnable ? { runnable } : {}),
    });
  }
  return out;
}

export function findRunnableEntryForTarget(
  entries: RunnableManifestEntry[],
  target: string,
): RunnableManifestEntry | null {
  const want = normalizeTargetLabel(target);
  for (const e of entries) {
    if (normalizeTargetLabel(e.label) === want) return e;
  }
  return null;
}

export async function readRunnableManifest(manifestPath: string): Promise<RunnableManifestEntry[]> {
  const txt = await fsp.readFile(manifestPath, "utf8");
  return parseRunnableManifest(txt);
}

export async function inferRunnableFromOutPath(opts: {
  label: string;
  outPath: string;
  importer?: string;
  mode?: "static" | "ssr";
  framework?: string;
}): Promise<RunnableContract | null> {
  const binDir = path.join(opts.outPath, "bin");
  const bins: string[] = [];
  try {
    const files = await fsp.readdir(binDir);
    for (const f of files) {
      const p = path.join(binDir, f);
      try {
        const st = await fsp.stat(p);
        if (st.isFile() && (st.mode & 0o111) !== 0) bins.push(p);
      } catch {}
    }
  } catch {}

  if (bins.length > 0) {
    return {
      kind: "native-bin",
      run: { prod: { argv: [bins[0]] } },
      artifacts: { bins },
    };
  }

  const dist = path.join(opts.outPath, "dist");
  const wantSsr = opts.mode === "ssr";
  if (wantSsr) {
    const serverEntry = path.join(dist, "server", "index.js");
    const clientDir = path.join(dist, "client");
    return {
      kind: "webapp-ssr",
      framework: opts.framework || undefined,
      run: {
        prod: { argv: ["node", serverEntry] },
        ...(opts.importer
          ? {
              dev: {
                argv: ["pnpm", "--dir", opts.importer, "dev:ssr"],
              },
            }
          : {}),
      },
      artifacts: { serverEntry, clientDir },
    };
  }
  try {
    const st = await fsp.stat(dist);
    if (!st.isDirectory()) return null;
  } catch {
    return null;
  }

  return {
    kind: "webapp",
    run: {
      prod: {
        argv: ["python3", "-m", "http.server", "--directory", dist],
      },
      ...(opts.importer
        ? {
            dev: {
              argv: ["pnpm", "--dir", opts.importer, "dev"],
            },
          }
        : {}),
    },
    artifacts: { dist },
  };
}

export function formatRunnableLine(entry: RunnableManifestEntry): string {
  const contract = entry.runnable;
  if (!contract) return `${entry.label} (non-runnable)`;
  const kind = contract.kind || "runnable";
  const prod = contract.run.prod.argv.join(" ");
  const dev = contract.run.dev ? ` | dev: ${contract.run.dev.argv.join(" ")}` : "";
  return `${entry.label} [${kind}] -> ${prod}${dev}`;
}

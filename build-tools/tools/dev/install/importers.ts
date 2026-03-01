import * as fsp from "node:fs/promises";
import path from "node:path";
import { getImporterRootsContract } from "../../lib/importer-roots.ts";

export async function discoverImportersWithLock(root: string): Promise<string[]> {
  const { allowDotImporter, workspaceRoots } = getImporterRootsContract();
  const out: string[] = [];
  if (allowDotImporter) {
    try {
      await fsp.access(path.join(root, "pnpm-lock.yaml"));
      out.push(".");
    } catch {}
  }
  for (const base of workspaceRoots) {
    const baseAbs = path.join(root, base);
    try {
      const entries = await fsp.readdir(baseAbs).catch(() => [] as string[]);
      for (const d of entries) {
        const p = path.join(baseAbs, d);
        try {
          const st = await fsp.stat(p);
          if (!st.isDirectory()) continue;
          try {
            await fsp.access(path.join(p, "pnpm-lock.yaml"));
            out.push(path.relative(root, p) || ".");
          } catch {}
        } catch {}
      }
    } catch {}
  }
  return out;
}

export async function sharedUnifiedStorePath(root: string): Promise<string> {
  try {
    const marker = path.join(root, "buck-out", ".unified-pnpm-store", "path");
    const p = String(await fsp.readFile(marker, "utf8")).trim();
    if (!p) return "";
    await fsp.access(p);
    return p;
  } catch {
    return "";
  }
}

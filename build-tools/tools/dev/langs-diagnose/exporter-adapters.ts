import { pathExists, sourcePath, toFileUrl } from "./fs";

export async function detectExporterAdapters(): Promise<string[]> {
  const adapters: string[] = [];
  const contractPath = await sourcePath("build-tools/tools/buck/exporter/lang/contract.ts");

  if (await pathExists(contractPath)) {
    try {
      const mod = (await import(toFileUrl(contractPath))) as any;
      const load = mod.loadPresentAdapters as (() => Promise<any[]>) | undefined;
      if (typeof load === "function") {
        const loaded = await load();
        for (const a of loaded || []) {
          if (a && typeof a.name === "string") adapters.push(String(a.name));
        }
      }
    } catch {
      // ignore
    }
  }

  return Array.from(new Set(adapters)).sort();
}

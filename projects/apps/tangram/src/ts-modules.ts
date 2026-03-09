import tsManifest from "./ts-modules.manifest.json";

type TsModuleManifest = {
  defaultModuleKey: string;
  modules: Array<{
    moduleKey: string;
    sourceEntryPath: string;
    runtimeImportPath: string;
  }>;
};

const manifest = tsManifest as TsModuleManifest;

export type TsModuleNamespace = Record<string, unknown>;

function manifestEntryFor(moduleKey: string) {
  const entry = manifest.modules.find((mod) => mod.moduleKey === moduleKey);
  if (!entry) {
    throw new Error(`unknown TS module key '${moduleKey}'`);
  }
  return entry;
}

export function listTsModules(): string[] {
  return manifest.modules.map((mod) => mod.moduleKey);
}

export function defaultTsModuleKey(): string {
  return manifest.defaultModuleKey;
}

export async function loadTsModule(moduleKey: string): Promise<TsModuleNamespace> {
  const entry = manifestEntryFor(moduleKey);
  return (await import(entry.runtimeImportPath)) as TsModuleNamespace;
}

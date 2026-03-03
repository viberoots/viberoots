export type WasmModuleRuntimeDestinations = {
  client: string;
  server: string;
};

export type WasmModuleManifestEntry = {
  moduleKey: string;
  sourcePath: string;
  runtimeDestinations: WasmModuleRuntimeDestinations;
};

export type WasmModuleManifest = {
  defaultModuleKey: string;
  modules: WasmModuleManifestEntry[];
};

export type TsModuleManifestEntry = {
  moduleKey: string;
  sourceEntryPath: string;
  runtimeImportPath: string;
};

export type TsModuleManifest = {
  defaultModuleKey: string;
  modules: TsModuleManifestEntry[];
};

function readString(obj: Record<string, unknown>, key: string, context: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${context}: '${key}' must be a non-empty string`);
  }
  return value;
}

function readRecord(
  obj: Record<string, unknown>,
  key: string,
  context: string,
): Record<string, unknown> {
  const value = obj[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context}: '${key}' must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertModuleKeysUnique(
  entries: Array<{ moduleKey: string }>,
  context: string,
): Set<string> {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.moduleKey)) {
      throw new Error(`${context}: duplicate module key '${entry.moduleKey}'`);
    }
    seen.add(entry.moduleKey);
  }
  return seen;
}

export function parseWasmModuleManifest(value: unknown, context: string): WasmModuleManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context}: manifest root must be an object`);
  }
  const root = value as Record<string, unknown>;
  const defaultModuleKey = readString(root, "defaultModuleKey", context);
  const modules = root.modules;
  if (!Array.isArray(modules) || modules.length === 0) {
    throw new Error(`${context}: 'modules' must be a non-empty array`);
  }

  const parsed: WasmModuleManifestEntry[] = modules.map((entry, index) => {
    const rowContext = `${context}: modules[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${rowContext}: row must be an object`);
    }
    const row = entry as Record<string, unknown>;
    const runtime = readRecord(row, "runtimeDestinations", rowContext);
    return {
      moduleKey: readString(row, "moduleKey", rowContext),
      sourcePath: readString(row, "sourcePath", rowContext),
      runtimeDestinations: {
        client: readString(runtime, "client", `${rowContext}.runtimeDestinations`),
        server: readString(runtime, "server", `${rowContext}.runtimeDestinations`),
      },
    };
  });

  const seen = assertModuleKeysUnique(parsed, context);
  if (!seen.has(defaultModuleKey)) {
    throw new Error(`${context}: default module key '${defaultModuleKey}' is not declared`);
  }

  return { defaultModuleKey, modules: parsed };
}

export function parseTsModuleManifest(value: unknown, context: string): TsModuleManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context}: manifest root must be an object`);
  }
  const root = value as Record<string, unknown>;
  const defaultModuleKey = readString(root, "defaultModuleKey", context);
  const modules = root.modules;
  if (!Array.isArray(modules) || modules.length === 0) {
    throw new Error(`${context}: 'modules' must be a non-empty array`);
  }

  const parsed: TsModuleManifestEntry[] = modules.map((entry, index) => {
    const rowContext = `${context}: modules[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${rowContext}: row must be an object`);
    }
    const row = entry as Record<string, unknown>;
    return {
      moduleKey: readString(row, "moduleKey", rowContext),
      sourceEntryPath: readString(row, "sourceEntryPath", rowContext),
      runtimeImportPath: readString(row, "runtimeImportPath", rowContext),
    };
  });

  const seen = assertModuleKeysUnique(parsed, context);
  if (!seen.has(defaultModuleKey)) {
    throw new Error(`${context}: default module key '${defaultModuleKey}' is not declared`);
  }

  return { defaultModuleKey, modules: parsed };
}

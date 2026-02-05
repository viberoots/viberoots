import fs from "node:fs";
import { fileURLToPath } from "node:url";

export type ImporterRootsContract = {
  allowDotImporter: boolean;
  workspaceRoots: string[];
};

type RawImporterRootsContract = Partial<{
  allowDotImporter: unknown;
  workspaceRoots: unknown;
}>;

const DEFAULT_WORKSPACE_ROOTS = ["projects/apps", "projects/libs"];

const CONTRACT_JSON_PATH = fileURLToPath(new URL("./importer-roots.json", import.meta.url));

let cached: ImporterRootsContract | null = null;

function normalizeWorkspaceRoots(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim().replace(/^\/+/, "").replace(/\/+$/, "");
    if (!trimmed) continue;
    if (trimmed === ".") continue;
    if (trimmed.includes("\\")) continue;
    const parts = trimmed.split("/");
    if (parts.some((p) => p === "" || p === "." || p === "..")) continue;
    out.push(parts.join("/"));
  }
  // Dedupe + stable order
  return Array.from(new Set(out)).sort((a, b) => a.localeCompare(b));
}

export function getImporterRootsContract(): ImporterRootsContract {
  if (cached) return cached;

  let rawTxt = "";
  try {
    rawTxt = fs.readFileSync(CONTRACT_JSON_PATH, "utf8");
  } catch (e) {
    throw new Error(
      `importer-roots contract missing/unreadable at ${CONTRACT_JSON_PATH}. ` +
        `Expected build-tools/tools/lib/importer-roots.json to exist. Original error: ${String(e)}`,
    );
  }

  let parsed: RawImporterRootsContract = {};
  try {
    parsed = JSON.parse(rawTxt) as RawImporterRootsContract;
  } catch (e) {
    throw new Error(
      `importer-roots contract is not valid JSON at ${CONTRACT_JSON_PATH}. Original error: ${String(e)}`,
    );
  }

  const allowDotImporter = parsed.allowDotImporter === false ? false : true;
  const workspaceRootsRaw = normalizeWorkspaceRoots(parsed.workspaceRoots);
  const workspaceRoots =
    workspaceRootsRaw.length > 0 ? workspaceRootsRaw : DEFAULT_WORKSPACE_ROOTS.slice();

  cached = { allowDotImporter, workspaceRoots };
  return cached;
}

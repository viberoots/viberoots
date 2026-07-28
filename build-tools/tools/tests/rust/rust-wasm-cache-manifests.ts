import { parseMaterializationManifest } from "../../remote-exec/nix-store-materialize";

export function groupWasmCacheManifests(manifests: Record<string, any>[]) {
  const groups = new Map<string, Record<string, any>[]>();
  for (const manifest of manifests) {
    const snapshot = String(manifest.sourceSnapshot || "");
    groups.set(snapshot, [...(groups.get(snapshot) || []), manifest]);
  }
  return [...groups.values()].map((entries) =>
    parseMaterializationManifest({
      ...entries[0],
      storePaths: entries.flatMap((entry) => entry.storePaths),
    }),
  );
}

import type { CredentialMap } from "./cloud-control-credential-map";

export function rotateCredentialMap(map: CredentialMap, staleFiles: string[]): CredentialMap {
  const stale = new Set(staleFiles);
  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, "");
  return {
    ...map,
    entries: map.entries.map((entry) =>
      stale.has(entry.file)
        ? {
            ...entry,
            source: rotatedSource(entry.source, suffix),
            rotation: {
              ...entry.rotation,
              staleDetectionEvidenceRef: `${entry.rotation.staleDetectionEvidenceRef}/rotation-${suffix}`,
            },
          }
        : entry,
    ),
  };
}

function rotatedSource(source: unknown, suffix: string): unknown {
  const typed = source as Record<string, unknown>;
  if (typed.kind === "generated-secret-write-plan") {
    return {
      ...typed,
      evidenceRef: `${typed.evidenceRef}/rotation-${suffix}`,
      writePlanRef: `${typed.writePlanRef}/rotation-${suffix}`,
    };
  }
  return { ...typed, evidenceRef: `${typed.evidenceRef}/rotation-${suffix}` };
}

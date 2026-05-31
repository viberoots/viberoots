import type { CredentialMap } from "./cloud-control-credential-map";
import type { ReloadEvidence } from "./control-plane-credential-staging-types";

export type CredentialManifestLike = { requiredFiles?: string[] };

export function requiredFiles(manifest: CredentialManifestLike): string[] {
  return [...new Set((manifest.requiredFiles || []).map(String))].sort();
}

export function backendRefs(map: CredentialMap): string[] {
  return map.entries.flatMap((entry) => {
    const source = entry.source as any;
    return source.kind === "secret-backend-ref" ? [source.ref] : [];
  });
}

export function writePlanIds(map: CredentialMap): string[] {
  return map.entries.flatMap((entry) => {
    const source = entry.source as any;
    return source.kind === "generated-secret-write-plan" ? [source.writePlanRef] : [];
  });
}

export function hostSourceIds(map: CredentialMap): string[] {
  return map.entries.flatMap((entry) => {
    const source = entry.source as any;
    return source.kind === "host-credential-source" ? [source.hostSourceRef] : [];
  });
}

export function staleDetection(map: CredentialMap, staleFiles: string[]) {
  const stale = new Set(staleFiles);
  return map.entries.map((entry) => ({
    file: entry.file,
    stale: stale.has(entry.file),
    evidenceRef: entry.rotation.staleDetectionEvidenceRef,
  }));
}

export function reloadEvidence(): ReloadEvidence {
  return {
    mode: "fixture-reload-evidence",
    service: {
      unit: "deployment-control-plane-service.service",
      action: "restart-recorded",
      evidenceRef: "evidence://credential-staging/reload/service",
    },
    workers: [1, 2].map((index) => ({
      unit: `deployment-control-plane-worker-${index}.service`,
      action: "restart-recorded",
      evidenceRef: `evidence://credential-staging/reload/worker-${index}`,
    })),
  };
}

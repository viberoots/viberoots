import type { NixBuilderPolicy } from "../../lib/nix-builder-policy";
import type { RemoteExecTargetMetadata } from "../remote-exec-policy-check";

function parseEvidenceValue(raw: string): NixBuilderPolicy | string {
  if (raw === "local_only" || raw === "inherit_config" || raw === "force_builders_file") {
    return raw;
  }
  return raw;
}

function parseMetadataValue(
  text: string,
  keys: readonly string[],
): NixBuilderPolicy | string | undefined {
  for (const key of keys) {
    const match = text.match(
      new RegExp(`${key}["']?\\s*[:=]\\s*(?:"([^"]+)"|'([^']+)'|([^,\\s)\\]}]+))`),
    );
    if (match) return parseEvidenceValue(String(match[1] || match[2] || match[3] || ""));
  }
  return undefined;
}

function parseLabeledPolicy(labels: readonly string[], prefix: string) {
  for (const label of labels) {
    if (label.startsWith(prefix)) return parseEvidenceValue(label.slice(prefix.length));
  }
  return undefined;
}

function parseProviderLabel(text: string, prefix: string) {
  const start = text.indexOf(prefix);
  if (start < 0) return undefined;
  const value = text.slice(start + prefix.length).match(/^[A-Za-z0-9_-]+/)?.[0];
  return value ? parseEvidenceValue(value) : undefined;
}

export function parseBuilderPolicyMetadata(
  labels: readonly string[],
  providerText: string,
): Partial<RemoteExecTargetMetadata> {
  const remoteBuilderSmokePath =
    providerText.match(/remote_builder_smoke_path=<source ([^>]+)>/)?.[1] ||
    (parseMetadataValue(providerText, ["remote_builder_smoke_path"]) as string | undefined);
  return {
    nixBuilderPolicy:
      parseLabeledPolicy(labels, "nix-builder:") ||
      parseProviderLabel(providerText, "nix-builder:") ||
      parseMetadataValue(providerText, ["nix_builder_policy", "builder_policy"]),
    remoteBuilderSmokePolicy:
      parseLabeledPolicy(labels, "remote-builder-smoke:") ||
      parseProviderLabel(providerText, "remote-builder-smoke:") ||
      parseMetadataValue(providerText, ["remote_builder_smoke", "remote_builder_smoke_policy"]),
    ...(remoteBuilderSmokePath ? { remoteBuilderSmokePath } : {}),
  };
}

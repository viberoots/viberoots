import { spawnSync } from "node:child_process";
import { normalizeTargetLabel } from "../../lib/labels";
import { resolveToolPathSync } from "../../lib/tool-paths";
import {
  assertRemoteTargetsAllowed,
  type RemoteExecTargetMetadata,
} from "../remote-exec-policy-check";
import type { NixBuilderPolicy } from "../../lib/nix-builder-policy";
import {
  buckCqueryArgsForExecutionPolicy,
  targetPlatformArgsForPolicy,
  type VerifyExecutionPolicy,
} from "./remote-policy";
import type { VerifyTargetLabels } from "./target-passes";

type CqueryInfo = {
  labels?: string[];
  "buck.type"?: string;
};

type BuckRunner = (args: string[]) => { status: number | null; stdout: string; stderr: string };

function defaultRunner(root: string): BuckRunner {
  const buck2Path = resolveToolPathSync("buck2");
  return (args) => {
    const result = spawnSync(buck2Path, args, {
      cwd: root,
      env: {
        ...process.env,
        RUST_LOG:
          (process.env.RUST_LOG || "warn") +
          ",buck2_client_ctx::file_tailers::tailer=off,buck2_event_log::writer=off",
        BUCK_LOG:
          (process.env.BUCK_LOG || "warn") +
          ",buck2_client_ctx::file_tailers::tailer=off,buck2_event_log::writer=off",
      },
      encoding: "utf8",
    });
    return {
      status: result.status,
      stdout: String(result.stdout || ""),
      stderr: String(result.stderr || ""),
    };
  };
}

function cqueryExpr(targets: readonly string[]): string {
  return targets.length === 1 ? targets[0]! : `(${targets.join(" + ")})`;
}

function parseCqueryMetadata(stdout: string): Map<string, CqueryInfo> {
  const parsed = JSON.parse(stdout) as Record<string, CqueryInfo>;
  return new Map(
    Object.entries(parsed || {}).map(([target, attrs]) => [normalizeTargetLabel(target), attrs]),
  );
}

function parseProviderMetadata(
  target: string,
  providerText: string,
): Partial<RemoteExecTargetMetadata> {
  const hasExternalRunner = providerText.includes("ExternalRunnerTestInfo");
  const commandText =
    providerText.match(/ExternalRunnerTestInfo\([\s\S]*?command=\[(?<body>[\s\S]*?)\],\s+env=/)
      ?.groups?.body || "";
  const executableText = commandText
    .replace(/hidden=\[[\s\S]*?\]/g, "hidden=[]")
    .replace(/<[^>]+>/g, "<handle>");
  return {
    target,
    runFromProjectRoot: /run_from_project_root=True/.test(providerText),
    useProjectRelativePaths: /use_project_relative_paths=True/.test(providerText),
    localResources: /local_resources=\{[^}\n]*[A-Za-z0-9_:-]/.test(providerText)
      ? ["provider-local-resources"]
      : [],
    requiredLocalResources: /required_local_resources=\[[^\]\n]*[A-Za-z0-9_:-]/.test(providerText)
      ? ["provider-required-local-resources"]
      : [],
    networkAccess: /network_access=True/.test(providerText),
    commandInputsDeclared:
      hasExternalRunner &&
      /command=\[\s*cmd_args\([^)]*hidden=\[[^\]]*[A-Za-z0-9_.\/:-]/s.test(providerText),
    requiresWorkspaceRootLookup:
      /\$WORKSPACE_ROOT|WORKSPACE_ROOT|\$FLK_ROOT|FLK_ROOT|path:\$FLK_ROOT|build-tools\//.test(
        executableText,
      ),
    ambientPathDependency:
      /\bcommand -v\b|\$\(command -v\b|\/usr\/bin\/env|\bbash\b|\bnode\b|\bnix\b|\btimeout\b|\bgit\b|\bfind\b/.test(
        executableText,
      ),
  };
}

function parsePolicyValue(raw: string): NixBuilderPolicy | undefined {
  if (raw === "local_only" || raw === "inherit_config" || raw === "force_builders_file") {
    return raw;
  }
  return undefined;
}

function parseEvidenceValue(raw: string): NixBuilderPolicy | string {
  return parsePolicyValue(raw) || raw;
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

function parseLabeledPolicy(
  labels: readonly string[],
  prefix: string,
): NixBuilderPolicy | string | undefined {
  for (const label of labels) {
    if (label.startsWith(prefix)) return parseEvidenceValue(label.slice(prefix.length));
  }
  return undefined;
}

function parseBuilderPolicyMetadata(
  labels: readonly string[],
  providerText: string,
): Partial<RemoteExecTargetMetadata> {
  return {
    nixBuilderPolicy:
      parseLabeledPolicy(labels, "nix-builder:") ||
      parseMetadataValue(providerText, ["nix_builder_policy", "builder_policy"]),
    remoteBuilderSmokePolicy:
      parseLabeledPolicy(labels, "remote-builder-smoke:") ||
      parseMetadataValue(providerText, ["remote_builder_smoke", "remote_builder_smoke_policy"]),
  };
}

function hasEvidenceLabel(labels: readonly string[], providerText: string, label: string): boolean {
  return labels.includes(label) || providerText.includes(label);
}

function parseSourceSnapshotMetadata(
  labels: readonly string[],
  providerText: string,
): Partial<RemoteExecTargetMetadata> {
  const hasSnapshotEvidence =
    labels.some((label) => label.startsWith("source-snapshot:")) ||
    providerText.includes("source-snapshot:");
  if (!hasSnapshotEvidence) return {};
  return {
    sourceSnapshotRootDeclared: hasEvidenceLabel(
      labels,
      providerText,
      "source-snapshot:declared-root",
    ),
    sourceSnapshotManifestDeclared: hasEvidenceLabel(
      labels,
      providerText,
      "source-snapshot:manifest",
    ),
    declaredGraphPath: hasEvidenceLabel(labels, providerText, "source-snapshot:graph"),
  };
}

export function collectRemoteExecTargetMetadata(opts: {
  root: string;
  iso: string;
  targets: VerifyTargetLabels[];
  executionPolicy: VerifyExecutionPolicy;
  runBuck?: BuckRunner;
}): RemoteExecTargetMetadata[] {
  if (opts.targets.length === 0) return [];
  const runBuck = opts.runBuck || defaultRunner(opts.root);
  const targetNames = opts.targets.map((entry) => entry.target);
  const cquery = runBuck([
    "--isolation-dir",
    opts.iso,
    "cquery",
    ...buckCqueryArgsForExecutionPolicy(opts.executionPolicy),
    ...targetPlatformArgsForPolicy(opts.executionPolicy),
    "--json",
    "--output-attribute",
    "labels",
    "--output-attribute",
    "buck.type",
    cqueryExpr(targetNames),
  ]);
  if (cquery.status !== 0) {
    throw new Error(`remote policy cquery failed (${cquery.status}): ${cquery.stderr.trim()}`);
  }
  const cqueryByTarget = parseCqueryMetadata(cquery.stdout || "{}");
  return opts.targets.map((entry) => {
    const provider = runBuck([
      "--isolation-dir",
      opts.iso,
      "audit",
      "providers",
      ...buckCqueryArgsForExecutionPolicy(opts.executionPolicy),
      ...targetPlatformArgsForPolicy(opts.executionPolicy),
      entry.target,
    ]);
    if (provider.status !== 0) {
      throw new Error(
        `remote policy provider audit failed for ${entry.target}: ${provider.stderr.trim()}`,
      );
    }
    const attrs = cqueryByTarget.get(entry.target) || {};
    const labels = attrs.labels || [...entry.labels];
    return {
      target: entry.target,
      ruleFamily: attrs["buck.type"],
      labels,
      ...parseProviderMetadata(entry.target, provider.stdout),
      ...parseBuilderPolicyMetadata(labels, provider.stdout),
      ...parseSourceSnapshotMetadata(labels, provider.stdout),
    };
  });
}

export function assertVerifyRemoteTargetsAllowed(opts: {
  root: string;
  iso: string;
  targets: VerifyTargetLabels[];
  executionPolicy: VerifyExecutionPolicy;
  runBuck?: BuckRunner;
}): void {
  const profilePrefix = opts.executionPolicy.profilePrefix;
  const allowedProfiles = [
    ...Object.values(opts.executionPolicy.passProfiles),
    ...(profilePrefix ? [`${profilePrefix}-default`, `${profilePrefix}-large`] : []),
  ];
  assertRemoteTargetsAllowed({
    mode: opts.executionPolicy.mode,
    targets: collectRemoteExecTargetMetadata(opts),
    allowedProfiles,
  });
}

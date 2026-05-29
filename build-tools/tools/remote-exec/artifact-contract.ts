import path from "node:path";

export type RemoteArtifactScope = "run" | "pass" | "target";

export type RemoteArtifactRedaction =
  | "public"
  | "redacted-summary"
  | "secret-reference"
  | "sensitive-debug";

export type RemoteArtifactContentType =
  | "application/json"
  | "text/plain"
  | "application/zstd+buck-event-log"
  | "application/vnd.viberoots.directory";

export type RemoteArtifactRetention =
  | "run-summary"
  | "debug-on-failure"
  | "coverage-merge-input"
  | "conformance-evidence";

export type RemoteArtifactCategory =
  | "buck-event-log"
  | "buck-build-report"
  | "buck-build-id"
  | "buck-command-report"
  | "test-stdout-summary"
  | "test-stderr-summary"
  | "nix-build-log"
  | "store-path-manifest"
  | "raw-coverage"
  | "source-snapshot-manifest"
  | "remote-conformance-evidence"
  | "failed-input-materialization"
  | "failed-output-materialization"
  | "failed-materialization-policy";

export type RemoteArtifactDefinition = {
  category: RemoteArtifactCategory;
  scope: RemoteArtifactScope;
  fileName: string;
  contentType: RemoteArtifactContentType;
  redaction: RemoteArtifactRedaction;
  retention: RemoteArtifactRetention;
};

const DEFINITIONS: Record<RemoteArtifactCategory, RemoteArtifactDefinition> = {
  "buck-event-log": pass("buck-event-log.pb.zst", "application/zstd+buck-event-log"),
  "buck-build-report": pass("buck-build-report.json", "application/json"),
  "buck-build-id": pass("buck-build-id.txt", "text/plain"),
  "buck-command-report": pass("buck-command-report.json", "application/json"),
  "test-stdout-summary": pass("test-executor-stdout.log", "text/plain"),
  "test-stderr-summary": pass("test-executor-stderr.log", "text/plain"),
  "nix-build-log": target("nix-build.log", "text/plain", "debug-on-failure"),
  "store-path-manifest": target("store-paths.json", "application/json", "run-summary"),
  "raw-coverage": target(
    "node-v8-coverage",
    "application/vnd.viberoots.directory",
    "coverage-merge-input",
  ),
  "source-snapshot-manifest": target(
    "source-snapshot.manifest.json",
    "application/json",
    "run-summary",
  ),
  "remote-conformance-evidence": target(
    "remote-conformance.json",
    "application/json",
    "conformance-evidence",
  ),
  "failed-input-materialization": passDir("failed-inputs", "debug-on-failure"),
  "failed-output-materialization": passDir("failed-outputs", "debug-on-failure"),
  "failed-materialization-policy": pass(
    "failed-materialization-policy.json",
    "application/json",
    "debug-on-failure",
  ),
};

function pass(
  fileName: string,
  contentType: RemoteArtifactContentType,
  retention: RemoteArtifactRetention = "run-summary",
): RemoteArtifactDefinition {
  return {
    category: "" as RemoteArtifactCategory,
    scope: "pass",
    fileName,
    contentType,
    redaction: "redacted-summary",
    retention,
  };
}

function passDir(fileName: string, retention: RemoteArtifactRetention): RemoteArtifactDefinition {
  return {
    category: "" as RemoteArtifactCategory,
    scope: "pass",
    fileName,
    contentType: "application/vnd.viberoots.directory",
    redaction: "sensitive-debug",
    retention,
  };
}

function target(
  fileName: string,
  contentType: RemoteArtifactContentType,
  retention: RemoteArtifactRetention,
): RemoteArtifactDefinition {
  return {
    category: "" as RemoteArtifactCategory,
    scope: "target",
    fileName,
    contentType,
    redaction: retention === "coverage-merge-input" ? "secret-reference" : "redacted-summary",
    retention,
  };
}

function withCategory(def: RemoteArtifactDefinition, category: RemoteArtifactCategory) {
  return { ...def, category };
}

export function remoteArtifactDefinition(
  category: RemoteArtifactCategory,
): RemoteArtifactDefinition {
  return withCategory(DEFINITIONS[category], category);
}

export function remoteRunArtifactDir(root: string, runId = "verify"): string {
  return path.join(root, "runs", safeArtifactSegment(runId));
}

export function remotePassArtifactDir(root: string, passName: string, runId = "verify"): string {
  return path.join(remoteRunArtifactDir(root, runId), "passes", safeArtifactSegment(passName));
}

export function remoteTargetArtifactDir(opts: {
  root: string;
  passName: string;
  target: string;
  runId?: string;
}): string {
  return path.join(
    remotePassArtifactDir(opts.root, opts.passName, opts.runId),
    "targets",
    safeArtifactSegment(opts.target),
  );
}

export function remoteArtifactPath(opts: {
  root: string;
  passName: string;
  category: RemoteArtifactCategory;
  target?: string;
  runId?: string;
}): string {
  const def = remoteArtifactDefinition(opts.category);
  const dir =
    def.scope === "target"
      ? remoteTargetArtifactDir({
          root: opts.root,
          passName: opts.passName,
          target: opts.target || "unknown-target",
          runId: opts.runId,
        })
      : remotePassArtifactDir(opts.root, opts.passName, opts.runId);
  return path.join(dir, def.fileName);
}

export function remoteDigestSidecarPath(artifactPath: string): string {
  return `${artifactPath}.sha256`;
}

export function safeArtifactSegment(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return safe || "unnamed";
}

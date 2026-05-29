import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  isRemoteVerifyPolicy,
  remoteProfileForPass,
  type VerifyExecutionPolicy,
} from "./remote-policy";
import {
  remoteArtifactDefinition,
  remoteArtifactPath,
  remotePassArtifactDir,
  type RemoteArtifactCategory,
} from "../../remote-exec/artifact-contract";

function isEnabled(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

function artifactPath(
  policy: VerifyExecutionPolicy,
  passName: string,
  category: RemoteArtifactCategory,
): string {
  if (!policy.artifactDir) throw new Error("VBR_REMOTE_ARTIFACT_DIR is required for remote verify");
  return remoteArtifactPath({ root: policy.artifactDir, passName, category });
}

function materializationPolicy(env: NodeJS.ProcessEnv): {
  failedInputs: boolean;
  failedOutputs: boolean;
} {
  return {
    failedInputs: isEnabled(env.VBR_REMOTE_MATERIALIZE_FAILED_INPUTS),
    failedOutputs: isEnabled(env.VBR_REMOTE_MATERIALIZE_FAILED_OUTPUTS),
  };
}

export function remoteBuckPassArtifactDir(policy: VerifyExecutionPolicy, passName: string): string {
  if (!policy.artifactDir) throw new Error("VBR_REMOTE_ARTIFACT_DIR is required for remote verify");
  return remotePassArtifactDir(policy.artifactDir, passName);
}

export function remoteBuckArtifactArgs(
  policy: VerifyExecutionPolicy,
  passName: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (!isRemoteVerifyPolicy(policy)) return [];
  const materialization = materializationPolicy(env);
  const args = [
    "--event-log",
    artifactPath(policy, passName, "buck-event-log"),
    "--build-report",
    artifactPath(policy, passName, "buck-build-report"),
    "--write-build-id",
    artifactPath(policy, passName, "buck-build-id"),
    "--command-report-path",
    artifactPath(policy, passName, "buck-command-report"),
    "--test-executor-stdout",
    artifactPath(policy, passName, "test-stdout-summary"),
    "--test-executor-stderr",
    artifactPath(policy, passName, "test-stderr-summary"),
  ];
  if (materialization.failedInputs) {
    args.push("--materialize-failed-inputs");
  }
  if (materialization.failedOutputs) {
    args.push("--materialize-failed-outputs");
  }
  return args;
}

function stripEventLogWriterSuppressions(value: string): string {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && part !== "buck2_event_log::writer=off")
    .join(",");
}

export function buckLogEnvForExecutionPolicy(
  policy: VerifyExecutionPolicy,
  env: NodeJS.ProcessEnv = process.env,
): Pick<NodeJS.ProcessEnv, "RUST_LOG" | "BUCK_LOG"> {
  if (isRemoteVerifyPolicy(policy)) {
    return {
      RUST_LOG: stripEventLogWriterSuppressions(env.RUST_LOG || "warn") || "warn",
      BUCK_LOG: stripEventLogWriterSuppressions(env.BUCK_LOG || "warn") || "warn",
    };
  }
  return {
    RUST_LOG:
      (env.RUST_LOG || "warn") +
      ",buck2_client_ctx::file_tailers::tailer=off,buck2_event_log::writer=off",
    BUCK_LOG:
      (env.BUCK_LOG || "warn") +
      ",buck2_client_ctx::file_tailers::tailer=off,buck2_event_log::writer=off",
  };
}

export function writeRemoteBuckMaterializationMetadata(opts: {
  policy: VerifyExecutionPolicy;
  passName: string;
  env?: NodeJS.ProcessEnv;
}): void {
  if (!isRemoteVerifyPolicy(opts.policy)) return;
  const env = opts.env || process.env;
  const materialization = materializationPolicy(env);
  if (!materialization.failedInputs && !materialization.failedOutputs) return;
  const passDir = remoteBuckPassArtifactDir(opts.policy, opts.passName);
  fs.mkdirSync(passDir, { recursive: true });
  fs.writeFileSync(
    path.join(passDir, "failed-materialization-policy.json"),
    JSON.stringify(
      {
        pass: opts.passName,
        artifactDir: passDir,
        contract: {
          failedInputs: remoteArtifactDefinition("failed-input-materialization"),
          failedOutputs: remoteArtifactDefinition("failed-output-materialization"),
          policy: remoteArtifactDefinition("failed-materialization-policy"),
        },
        failedInputs: materialization.failedInputs,
        failedOutputs: materialization.failedOutputs,
        buckFlags: [
          ...(materialization.failedInputs ? ["--materialize-failed-inputs"] : []),
          ...(materialization.failedOutputs ? ["--materialize-failed-outputs"] : []),
        ],
        note: "Pinned Buck2 supports bare failed-materialization flags only; repo-owned retention metadata is scoped here.",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

export function remoteBuckPolicySummary(
  policy: VerifyExecutionPolicy,
  passName: string,
): string | null {
  if (!isRemoteVerifyPolicy(policy)) return null;
  const content =
    policy.buckConfig && fs.existsSync(policy.buckConfig)
      ? fs.readFileSync(policy.buckConfig)
      : Buffer.from(policy.buckConfig || "");
  const fingerprint = crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  return [
    "[verify] remote buck policy",
    `mode=${policy.mode}`,
    `pass=${passName}`,
    `profile=${remoteProfileForPass(policy, passName) || "<none>"}`,
    `config_fingerprint=sha256:${fingerprint}`,
  ].join(" ");
}

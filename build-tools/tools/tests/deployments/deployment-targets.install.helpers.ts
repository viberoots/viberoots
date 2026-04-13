#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type {
  CloudflarePagesDeployment,
  DeploymentRequirement,
  DeploymentTargetException,
  KubernetesDeployment,
  NixosSharedHostDeployment,
  S3StaticDeployment,
} from "../../deployments/contract.ts";
import { resolveDeploymentFromTarget } from "../../deployments/deployment-query.ts";
import type {
  DeploymentAdmissionPolicy,
  DeploymentLanePolicy,
} from "../../deployments/deployment-policy.ts";
import type { DeploymentReleaseAction } from "../../deployments/deployment-release-actions.ts";

type ReviewedDeployment =
  | CloudflarePagesDeployment
  | KubernetesDeployment
  | NixosSharedHostDeployment
  | S3StaticDeployment;

function labelDir(label: string): string {
  return label.replace(/^\/\//, "").split(":")[0] || "";
}

function labelName(label: string): string {
  return label.split(":")[1] || "";
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

async function ensureParentDir(filePath: string): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
}

type TargetsFileFragment = {
  loadLines: string[];
  bodyLines: string[];
};

const SYNTHETIC_TARGETS_MANIFEST = ".tmp-deployment-targets.fragments.json";

function splitBodyBlocks(lines: string[]): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line === "") {
      if (current.length > 0) {
        blocks.push(current.join("\n"));
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}

function blockIdentity(block: string): string {
  const lines = block.split("\n");
  const ruleLine = lines[0] || "";
  const nameLine = lines.find((line) => line.trimStart().startsWith("name = "));
  return nameLine ? `${ruleLine}|${nameLine.trim()}` : block;
}

function appendTargetsFragment(
  fragments: Map<string, TargetsFileFragment>,
  dir: string,
  fragment: TargetsFileFragment,
) {
  const current = fragments.get(dir) || { loadLines: [], bodyLines: [] };
  for (const line of fragment.loadLines) {
    if (line && !current.loadLines.includes(line)) current.loadLines.push(line);
  }
  const currentBlocks = splitBodyBlocks(current.bodyLines);
  const blockIndexes = new Map(
    currentBlocks.map((block, index) => [blockIdentity(block), index] as const),
  );
  const bodyBlocks = splitBodyBlocks(fragment.bodyLines);
  for (const block of bodyBlocks) {
    if (!block) continue;
    const identity = blockIdentity(block);
    const existingIndex = blockIndexes.get(identity);
    if (existingIndex === undefined) {
      blockIndexes.set(identity, currentBlocks.length);
      currentBlocks.push(block);
      continue;
    }
    currentBlocks[existingIndex] = block;
  }
  current.bodyLines = currentBlocks.flatMap((block, index) =>
    index === 0 ? block.split("\n") : ["", ...block.split("\n")],
  );
  fragments.set(dir, current);
}

async function readTargetsFragments(
  workspaceRoot: string,
): Promise<Map<string, TargetsFileFragment>> {
  const manifestPath = path.join(workspaceRoot, SYNTHETIC_TARGETS_MANIFEST);
  try {
    const content = await fsp.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(content) as Record<string, TargetsFileFragment>;
    return new Map(Object.entries(parsed));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
}

async function writeTargetsManifest(
  workspaceRoot: string,
  fragments: Map<string, TargetsFileFragment>,
): Promise<void> {
  const manifestPath = path.join(workspaceRoot, SYNTHETIC_TARGETS_MANIFEST);
  await fsp.writeFile(
    manifestPath,
    JSON.stringify(Object.fromEntries(fragments.entries()), null, 2) + "\n",
    "utf8",
  );
}

async function writeTargetsFragments(
  workspaceRoot: string,
  newFragments: Map<string, TargetsFileFragment>,
): Promise<void> {
  const fragments = await readTargetsFragments(workspaceRoot);
  for (const [dir, fragment] of newFragments.entries()) {
    appendTargetsFragment(fragments, dir, fragment);
  }
  await Promise.all(
    Array.from(fragments.entries()).map(async ([dir, fragment]) => {
      const targetPath = path.join(workspaceRoot, dir, "TARGETS");
      const lines = [...fragment.loadLines, "", ...fragment.bodyLines];
      while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
      await ensureParentDir(targetPath);
      await fsp.writeFile(targetPath, lines.join("\n") + "\n", "utf8");
    }),
  );
  await writeTargetsManifest(workspaceRoot, fragments);
}

async function synchronizeInstalledDeployments(
  workspaceRoot: string,
  deployments: ReviewedDeployment[],
): Promise<void> {
  const resolved = await Promise.all(
    deployments.map((deployment) => resolveDeploymentFromTarget(workspaceRoot, deployment.label)),
  );
  for (const [index, deployment] of deployments.entries()) {
    Object.assign(deployment, resolved[index]);
  }
}

function renderStringList(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function renderStringDictLines(values: Record<string, string>, indent = "    "): string[] {
  return [
    `${indent}{`,
    ...Object.entries(values).map(
      ([key, value]) => `${indent}    ${JSON.stringify(key)}: ${JSON.stringify(String(value))},`,
    ),
    `${indent}},`,
  ];
}

function renderStringRecordList(
  values: ReadonlyArray<Record<string, string>>,
  indent = "    ",
): string[] {
  if (values.length === 0) return [`${indent}[],`];
  return [
    `${indent}[`,
    ...values.flatMap((value) => renderStringDictLines(value, `${indent}    `)),
    `${indent}],`,
  ];
}

function renderRequirementList(requirements: DeploymentRequirement[]): Record<string, string>[] {
  return requirements.map((requirement) => ({
    name: requirement.name,
    step: requirement.step,
    contract_id: requirement.contractId,
    required: requirement.required ? "true" : "false",
    ...(requirement.source ? { source: requirement.source } : {}),
    ...(requirement.previewVariant ? { preview_variant: requirement.previewVariant } : {}),
    ...(requirement.notes ? { notes: requirement.notes } : {}),
  }));
}

function renderSmokeLines(smoke: ReviewedDeployment["smoke"], indent = "    "): string[] {
  if (!smoke) return [];
  const smokeFields: Record<string, string> = {};
  if (smoke.runnerClass) smokeFields.runner_class = smoke.runnerClass;
  if (smoke.timeoutBudgetMs !== undefined) {
    smokeFields.timeout_budget_ms = String(smoke.timeoutBudgetMs);
  }
  const lines: string[] = [];
  if (Object.keys(smokeFields).length > 0) {
    lines.push(`${indent}smoke = {`);
    for (const [key, value] of Object.entries(smokeFields)) {
      lines.push(`${indent}    ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
    }
    lines.push(`${indent}},`);
  }
  if (smoke.exception) {
    const exceptionFields: Record<string, string> = {
      owner: smoke.exception.owner,
      reason: smoke.exception.reason,
      scope: smoke.exception.scope,
      ...(smoke.exception.reviewBy ? { review_by: smoke.exception.reviewBy } : {}),
      ...(smoke.exception.expiresAt ? { expires_at: smoke.exception.expiresAt } : {}),
      ...(smoke.exception.downgradeMode ? { downgrade_mode: smoke.exception.downgradeMode } : {}),
    };
    lines.push(`${indent}smoke_exception = {`);
    for (const [key, value] of Object.entries(exceptionFields)) {
      lines.push(`${indent}    ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
    }
    lines.push(`${indent}},`);
  }
  return lines;
}

function renderPreviewLines(deployment: CloudflarePagesDeployment, indent = "    "): string[] {
  if (!deployment.preview) return [];
  return [
    `${indent}preview = {`,
    `${indent}    "target_derivation": ${JSON.stringify(deployment.preview.targetDerivation)},`,
    `${indent}    "isolation_class": ${JSON.stringify(deployment.preview.isolationClass)},`,
    `${indent}    "identity_selector": ${JSON.stringify(deployment.preview.identitySelector)},`,
    `${indent}    "cleanup_ttl": ${JSON.stringify(deployment.preview.cleanupTtl)},`,
    `${indent}    "smoke_target": ${JSON.stringify(deployment.preview.smokeTarget)},`,
    `${indent}    "lock_scope": ${JSON.stringify(deployment.preview.lockScope)},`,
    `${indent}},`,
  ];
}

function renderBootstrapLines(deployment: NixosSharedHostDeployment, indent = "    "): string[] {
  if (!deployment.bootstrap) return [];
  return [
    `${indent}bootstrap = {`,
    `${indent}    "scope": ${JSON.stringify(deployment.bootstrap.scope)},`,
    `${indent}    "allow_first_install": ${JSON.stringify(
      deployment.bootstrap.modes.includes("first_install") ? "true" : "false",
    )},`,
    `${indent}    "allow_offline_recovery": ${JSON.stringify(
      deployment.bootstrap.modes.includes("offline_recovery") ? "true" : "false",
    )},`,
    `${indent}},`,
  ];
}

function renderPrerequisiteList(
  deployment: Pick<ReviewedDeployment, "prerequisites">,
): Record<string, string>[] {
  return deployment.prerequisites.map((prerequisite) => ({
    deployment_id: prerequisite.deploymentId,
    mode: prerequisite.mode,
  }));
}

function renderPromotionCompatibility(policy: DeploymentLanePolicy): string | undefined {
  const edges = policy.promotionCompatibility?.crossProviderPromotionEdges;
  if (!edges || edges.length === 0) return undefined;
  return JSON.stringify({
    cross_provider_promotion_edges: edges,
  });
}

function synchronizeGovernanceChecks(deployments: ReviewedDeployment[]): void {
  for (const deployment of deployments) {
    const branchProtection = deployment.lanePolicy.governance.branchProtections.find(
      (entry) => entry.stage === deployment.environmentStage,
    );
    if (!branchProtection) continue;
    branchProtection.requiredChecks = [...deployment.admissionPolicy.requiredChecks];
  }
}

function effectiveBranchProtectionChecks(opts: {
  deployments: ReviewedDeployment[];
  governanceRef: string;
  stage: string;
  fallback: string[];
}): string[] {
  const deployment = opts.deployments.find(
    (candidate) =>
      candidate.lanePolicy.governanceRef === opts.governanceRef &&
      candidate.environmentStage === opts.stage,
  );
  return deployment?.admissionPolicy.requiredChecks || opts.fallback;
}

async function installAppTargetsForDeployments(
  workspaceRoot: string,
  deployments: ReviewedDeployment[],
): Promise<void> {
  const components = uniqueBy(
    deployments.flatMap((deployment) => deployment.components),
    (component) => component.target,
  );
  await Promise.all(
    components.map(async (component) => {
      const targetPath = path.join(workspaceRoot, labelDir(component.target), "TARGETS");
      const framework =
        component.kind === "ssr-webapp" && "runtimeContract" in component.runtime
          ? component.runtime.runtimeContract.framework
          : "";
      const labels =
        component.kind === "ssr-webapp"
          ? ["kind:app", "webapp:ssr", `framework:${framework || "vite"}`]
          : ["kind:app", "webapp:static"];
      await ensureParentDir(targetPath);
      await fsp.writeFile(
        targetPath,
        [
          'load("@prelude//:rules.bzl", "genrule")',
          "",
          "genrule(",
          `    name = ${JSON.stringify(labelName(component.target))},`,
          `    out = ${JSON.stringify(`${labelName(component.target)}.txt`)},`,
          `    cmd = ${JSON.stringify(`printf ${labelName(component.target)} > $OUT`)},`,
          `    labels = ${renderStringList(labels)},`,
          '    visibility = ["PUBLIC"],',
          ")",
          "",
        ].join("\n"),
        "utf8",
      );
    }),
  );
}

function renderAdmissionPolicy(policyRef: string, policy: DeploymentAdmissionPolicy): string[] {
  return [
    "deployment_admission_policy(",
    `    name = ${JSON.stringify(labelName(policyRef))},`,
    `    allowed_refs = ${renderStringList(policy.allowedRefs)},`,
    `    required_checks = ${renderStringList(policy.requiredChecks)},`,
    `    required_approvals = ${renderStringList(policy.requiredApprovals)},`,
    `    retry_branch_policy = ${JSON.stringify(policy.retryBranchPolicy)},`,
    `    retry_approval_reuse = ${JSON.stringify(policy.retryApprovalReuse)},`,
    `    artifact_attestation_mode = ${JSON.stringify(policy.artifactAttestationMode)},`,
    `    trusted_builder_identities = ${renderStringList(
      policy.attestation?.trustedBuilderIdentities || [],
    )},`,
    `    accepted_provenance_formats = ${renderStringList(
      policy.attestation?.acceptedProvenanceFormats || [],
    )},`,
    `    artifact_binding = ${JSON.stringify(policy.attestation?.artifactBinding || "")},`,
    `    expired_attestation_behavior = ${JSON.stringify(
      policy.attestation?.expiredBehavior || "",
    )},`,
    `    revoked_attestation_behavior = ${JSON.stringify(
      policy.attestation?.revokedBehavior || "",
    )},`,
    `    attestation_trust_drift_behavior = ${JSON.stringify(
      policy.attestation?.trustDriftBehavior || "",
    )},`,
    `    require_artifact_signatures = ${
      policy.attestation?.signatureRequired ? "True" : "False"
    },`,
    `    trusted_signer_identities = ${renderStringList(
      policy.attestation?.trustedSignerIdentities || [],
    )},`,
    `    sbom_required = ${policy.sbom?.required ? "True" : "False"},`,
    `    accepted_sbom_formats = ${renderStringList(policy.sbom?.acceptedFormats || [])},`,
    ...[
      "    supply_chain_gates =",
      ...renderStringRecordList(
        (policy.supplyChainGates || []).map((gate) =>
          Object.fromEntries(Object.entries(gate).map(([key, value]) => [key, String(value)])),
        ),
      ),
    ],
    '    visibility = ["PUBLIC"],',
    ")",
    "",
  ];
}

function renderReleaseAction(action: DeploymentReleaseAction): string[] {
  return [
    "deployment_release_action(",
    `    name = ${JSON.stringify(labelName(action.ref))},`,
    `    type = ${JSON.stringify(action.type)},`,
    `    phase = ${JSON.stringify(action.phase)},`,
    `    run_condition = ${JSON.stringify(action.runCondition)},`,
    `    abort_behavior = ${JSON.stringify(action.abortBehavior)},`,
    `    data_compatibility = ${JSON.stringify(action.dataCompatibility)},`,
    "    replay_policy = {",
    ...Object.entries(action.replayPolicy).map(
      ([key, value]) => `        ${JSON.stringify(key)}: ${JSON.stringify(value)},`,
    ),
    "    },",
    "    duplicate_safety = {",
    ...Object.entries(action.duplicateSafety).map(
      ([key, value]) => `        ${JSON.stringify(key)}: ${JSON.stringify(value)},`,
    ),
    "    },",
    "    operation_keys = {",
    ...Object.entries(action.operationKeys).map(
      ([key, value]) => `        ${JSON.stringify(key)}: ${JSON.stringify(value)},`,
    ),
    "    },",
    `    required_secret_requirements = ${renderStringList(
      action.requiredSecretRequirementNames,
    )},`,
    `    required_runtime_config_requirements = ${renderStringList(
      action.requiredRuntimeConfigRequirementNames,
    )},`,
    '    visibility = ["PUBLIC"],',
    ")",
    "",
  ];
}

function renderTargetException(exception: DeploymentTargetException): string[] {
  return [
    "deployment_target_exception(",
    `    name = ${JSON.stringify(labelName(exception.ref))},`,
    `    exception_id = ${JSON.stringify(exception.exceptionId)},`,
    `    exception_kind = ${JSON.stringify(exception.exceptionKind)},`,
    `    affected_deployments = ${renderStringList(exception.affectedDeploymentIds)},`,
    `    old_provider_target_identity = ${JSON.stringify(exception.oldProviderTargetIdentity)},`,
    `    new_provider_target_identity = ${JSON.stringify(
      exception.newProviderTargetIdentity || "",
    )},`,
    `    shared_lock_scope = ${JSON.stringify(exception.sharedLockScope)},`,
    `    approval_evidence = ${JSON.stringify(exception.approvalEvidence)},`,
    `    effective_at = ${JSON.stringify(exception.effectiveAt)},`,
    `    expires_at = ${JSON.stringify(exception.expiresAt || "")},`,
    `    completion_signal = ${JSON.stringify(exception.completionSignal || "")},`,
    `    reconciliation_owner = ${JSON.stringify(exception.reconciliationOwner)},`,
    '    visibility = ["PUBLIC"],',
    ")",
    "",
  ];
}

function sharedPolicyTargetsByDir(
  deployments: ReviewedDeployment[],
): Map<string, TargetsFileFragment> {
  const lanePolicies = uniqueBy(
    deployments.map((deployment) => ({
      ref: deployment.lanePolicyRef,
      policy: deployment.lanePolicy,
    })),
    ({ ref }) => ref,
  );
  const governancePolicies = uniqueBy(
    lanePolicies.map(({ policy }) => ({
      ref: policy.governanceRef,
      governance: policy.governance,
    })),
    ({ ref }) => ref,
  );
  const admissionPolicies = uniqueBy(
    deployments.map((deployment) => ({
      ref: deployment.admissionPolicyRef,
      policy: deployment.admissionPolicy,
    })),
    ({ ref }) => ref,
  );
  const releaseActions = uniqueBy(
    deployments.flatMap((deployment) => deployment.releaseActions),
    (action) => action.ref,
  );
  const targetExceptions = uniqueBy(
    deployments.flatMap((deployment) => deployment.targetExceptions),
    (exception) => exception.ref,
  );
  const targetDirs = new Set<string>([
    ...lanePolicies.map(({ ref }) => labelDir(ref)),
    ...governancePolicies.map(({ ref }) => labelDir(ref)),
    ...admissionPolicies.map(({ ref }) => labelDir(ref)),
    ...releaseActions.map((action) => labelDir(action.ref)),
    ...targetExceptions.map((exception) => labelDir(exception.ref)),
  ]);
  const fragments = new Map<string, TargetsFileFragment>();
  for (const sharedDir of targetDirs) {
    appendTargetsFragment(fragments, sharedDir, {
      loadLines: [
        'load("//build-tools/deployments:defs.bzl", "deployment_admission_policy", "deployment_lane_governance", "deployment_lane_policy", "deployment_release_action", "deployment_target_exception")',
      ],
      bodyLines: [
        ...governancePolicies
          .filter(({ ref }) => labelDir(ref) === sharedDir)
          .flatMap(({ ref, governance }) => [
            "deployment_lane_governance(",
            `    name = ${JSON.stringify(labelName(ref))},`,
            `    scm_backend = ${JSON.stringify(governance.scmBackend)},`,
            `    repository = ${JSON.stringify(governance.repository)},`,
            "    branch_protections = [",
            ...governance.branchProtections.map((entry) => {
              const requiredChecks = effectiveBranchProtectionChecks({
                deployments,
                governanceRef: ref,
                stage: entry.stage,
                fallback: entry.requiredChecks,
              });
              return `        {"stage": ${JSON.stringify(entry.stage)}, "branch": ${JSON.stringify(entry.branch)}, "required_checks": ${JSON.stringify(requiredChecks.join(","))}, "fast_forward_only": ${JSON.stringify(entry.fastForwardOnly ? "true" : "false")}, "normal_advance_principals": ${JSON.stringify(entry.normalAdvancePrincipals.join(","))}, "emergency_direct_push_principals": ${JSON.stringify(entry.emergencyDirectPushPrincipals.join(","))}},`;
            }),
            "    ],",
            '    visibility = ["PUBLIC"],',
            ")",
            "",
          ]),
        ...lanePolicies
          .filter(({ ref }) => labelDir(ref) === sharedDir)
          .flatMap(({ ref, policy }) => {
            const promotionCompatibility = renderPromotionCompatibility(policy);
            return [
              "deployment_lane_policy(",
              `    name = ${JSON.stringify(labelName(ref))},`,
              `    stages = ${renderStringList(policy.stages)},`,
              `    stage_branches = {${Object.entries(policy.stageBranches)
                .map(([stage, branch]) => `${JSON.stringify(stage)}: ${JSON.stringify(branch)}`)
                .join(", ")}},`,
              `    allowed_promotion_edges = ${renderStringList(policy.allowedPromotionEdges)},`,
              `    artifact_reuse_mode = ${JSON.stringify(policy.artifactReuseMode)},`,
              ...(promotionCompatibility
                ? [`    promotion_compatibility = ${JSON.stringify(promotionCompatibility)},`]
                : []),
              `    governance_policy = ${JSON.stringify(policy.governanceRef)},`,
              '    visibility = ["PUBLIC"],',
              ")",
              "",
            ];
          }),
        ...admissionPolicies
          .filter(({ ref }) => labelDir(ref) === sharedDir)
          .flatMap(({ ref, policy }) => renderAdmissionPolicy(ref, policy)),
        ...releaseActions
          .filter((action) => labelDir(action.ref) === sharedDir)
          .flatMap((action) => renderReleaseAction(action)),
        ...targetExceptions
          .filter((exception) => labelDir(exception.ref) === sharedDir)
          .flatMap((exception) => renderTargetException(exception)),
      ],
    });
  }
  return fragments;
}

export async function installCloudflarePagesTargets(
  workspaceRoot: string,
  deployments: CloudflarePagesDeployment[],
): Promise<void> {
  synchronizeGovernanceChecks(deployments);
  await installAppTargetsForDeployments(workspaceRoot, deployments);
  const fragments = sharedPolicyTargetsByDir(deployments);
  for (const deployment of deployments) {
    appendTargetsFragment(fragments, labelDir(deployment.label), {
      loadLines: [
        'load("//build-tools/deployments:defs.bzl", "cloudflare_pages_static_webapp_deployment")',
      ],
      bodyLines: [
        "cloudflare_pages_static_webapp_deployment(",
        `    name = ${JSON.stringify(labelName(deployment.label))},`,
        `    component = ${JSON.stringify(deployment.component.target)},`,
        `    account = ${JSON.stringify(deployment.providerTarget.account)},`,
        `    project = ${JSON.stringify(deployment.providerTarget.project)},`,
        ...(deployment.providerTarget.id !== deployment.providerTarget.project
          ? [`    project_id = ${JSON.stringify(deployment.providerTarget.id)},`]
          : []),
        `    lane_policy = ${JSON.stringify(deployment.lanePolicyRef)},`,
        `    environment_stage = ${JSON.stringify(deployment.environmentStage)},`,
        `    admission_policy = ${JSON.stringify(deployment.admissionPolicyRef)},`,
        `    protection_class = ${JSON.stringify(deployment.protectionClass)},`,
        ...["    prerequisites =", ...renderStringRecordList(renderPrerequisiteList(deployment))],
        ...[
          "    secret_requirements =",
          ...renderStringRecordList(renderRequirementList(deployment.secretRequirements)),
        ],
        ...[
          "    runtime_config_requirements =",
          ...renderStringRecordList(renderRequirementList(deployment.runtimeConfigRequirements)),
        ],
        ...(deployment.releaseActions.length > 0
          ? [
              `    release_actions = ${renderStringList(deployment.releaseActions.map((action) => action.ref))},`,
            ]
          : []),
        ...(deployment.targetExceptions.length > 0
          ? [
              `    target_exceptions = ${renderStringList(
                deployment.targetExceptions.map((exception) => exception.ref),
              )},`,
            ]
          : []),
        ...renderSmokeLines(deployment.smoke),
        ...renderPreviewLines(deployment),
        ")",
        "",
      ],
    });
  }
  await writeTargetsFragments(workspaceRoot, fragments);
  await synchronizeInstalledDeployments(workspaceRoot, deployments);
}

export async function installS3StaticTargets(
  workspaceRoot: string,
  deployments: S3StaticDeployment[],
): Promise<void> {
  synchronizeGovernanceChecks(deployments);
  await installAppTargetsForDeployments(workspaceRoot, deployments);
  const fragments = sharedPolicyTargetsByDir(deployments);
  for (const deployment of deployments) {
    appendTargetsFragment(fragments, labelDir(deployment.label), {
      loadLines: ['load("//build-tools/deployments:defs.bzl", "s3_static_webapp_deployment")'],
      bodyLines: [
        "s3_static_webapp_deployment(",
        `    name = ${JSON.stringify(labelName(deployment.label))},`,
        `    component = ${JSON.stringify(deployment.component.target)},`,
        `    account = ${JSON.stringify(deployment.providerTarget.account)},`,
        `    bucket = ${JSON.stringify(deployment.providerTarget.bucket)},`,
        `    region = ${JSON.stringify(deployment.providerTarget.region)},`,
        ...(deployment.providerTarget.distribution
          ? [`    distribution = ${JSON.stringify(deployment.providerTarget.distribution)},`]
          : []),
        `    publisher_config = ${JSON.stringify(deployment.publisher.config)},`,
        ...(deployment.provisioner
          ? [`    provisioner = ${JSON.stringify(deployment.provisioner.type)},`]
          : []),
        `    lane_policy = ${JSON.stringify(deployment.lanePolicyRef)},`,
        `    environment_stage = ${JSON.stringify(deployment.environmentStage)},`,
        `    admission_policy = ${JSON.stringify(deployment.admissionPolicyRef)},`,
        `    protection_class = ${JSON.stringify(deployment.protectionClass)},`,
        ...["    prerequisites =", ...renderStringRecordList(renderPrerequisiteList(deployment))],
        ...[
          "    secret_requirements =",
          ...renderStringRecordList(renderRequirementList(deployment.secretRequirements)),
        ],
        ...[
          "    runtime_config_requirements =",
          ...renderStringRecordList(renderRequirementList(deployment.runtimeConfigRequirements)),
        ],
        ...renderSmokeLines(deployment.smoke),
        ")",
        "",
      ],
    });
  }
  await writeTargetsFragments(workspaceRoot, fragments);
  await synchronizeInstalledDeployments(workspaceRoot, deployments);
}

export async function installNixosSharedHostTargets(
  workspaceRoot: string,
  deployments: NixosSharedHostDeployment[],
): Promise<void> {
  synchronizeGovernanceChecks(deployments);
  await installAppTargetsForDeployments(workspaceRoot, deployments);
  const fragments = sharedPolicyTargetsByDir(deployments);
  for (const deployment of deployments) {
    const isMultiComponent = deployment.components.length > 1;
    const singleComponent = deployment.components[0];
    const isSsr = !!singleComponent && singleComponent.kind === "ssr-webapp";
    const loadRule = isMultiComponent
      ? "nixos_shared_host_multi_static_webapp_deployment"
      : isSsr
        ? "nixos_shared_host_ssr_webapp_deployment"
        : "nixos_shared_host_static_webapp_deployment";
    appendTargetsFragment(fragments, labelDir(deployment.label), {
      loadLines: [`load("//build-tools/deployments:defs.bzl", ${JSON.stringify(loadRule)})`],
      bodyLines: [
        `${loadRule}(`,
        `    name = ${JSON.stringify(labelName(deployment.label))},`,
        ...(isMultiComponent
          ? [
              "    components = [",
              ...deployment.components.flatMap((component) => [
                "        {",
                `            "id": ${JSON.stringify(component.id)},`,
                `            "target": ${JSON.stringify(component.target)},`,
                `            "app_name": ${JSON.stringify(component.runtime.appName)},`,
                `            "container_port": ${JSON.stringify(
                  String(component.runtime.containerPort),
                )},`,
                `            "health_path": ${JSON.stringify(component.runtime.healthPath || "")},`,
                `            "target_group": ${JSON.stringify(
                  component.runtime.targetGroup || "",
                )},`,
                "        },",
              ]),
              "    ],",
              ...(deployment.rolloutPolicy
                ? [
                    "    rollout_policy = {",
                    `        "mode": ${JSON.stringify(deployment.rolloutPolicy.mode)},`,
                    `        "abort": ${JSON.stringify(deployment.rolloutPolicy.abort)},`,
                    `        "smoke": ${JSON.stringify(deployment.rolloutPolicy.smoke)},`,
                    `        "steps": ${renderStringList(deployment.rolloutPolicy.steps)},`,
                    "    },",
                    `    target_group = ${JSON.stringify(
                      deployment.providerTarget.targetGroup || "",
                    )},`,
                  ]
                : []),
            ]
          : [
              `    component = ${JSON.stringify(singleComponent?.target || deployment.component.target)},`,
              `    app_name = ${JSON.stringify(singleComponent?.runtime.appName || deployment.runtime.appName)},`,
              `    container_port = ${
                singleComponent?.runtime.containerPort || deployment.runtime.containerPort
              },`,
              `    health_path = ${JSON.stringify(
                singleComponent?.runtime.healthPath || deployment.runtime.healthPath || "",
              )},`,
              `    target_group = ${JSON.stringify(
                singleComponent?.runtime.targetGroup || deployment.runtime.targetGroup || "",
              )},`,
              ...(isSsr &&
              singleComponent &&
              "runtimeContract" in singleComponent.runtime &&
              singleComponent.runtime.runtimeContract
                ? [
                    `    framework = ${JSON.stringify(
                      singleComponent.runtime.runtimeContract.framework,
                    )},`,
                  ]
                : []),
            ]),
        `    publisher = ${JSON.stringify(deployment.publisher.type)},`,
        ...(deployment.provisioner
          ? [`    provisioner = ${JSON.stringify(deployment.provisioner.type)},`]
          : []),
        `    lane_policy = ${JSON.stringify(deployment.lanePolicyRef)},`,
        `    environment_stage = ${JSON.stringify(deployment.environmentStage)},`,
        `    admission_policy = ${JSON.stringify(deployment.admissionPolicyRef)},`,
        `    protection_class = ${JSON.stringify(deployment.protectionClass)},`,
        ...["    prerequisites =", ...renderStringRecordList(renderPrerequisiteList(deployment))],
        ...[
          "    secret_requirements =",
          ...renderStringRecordList(renderRequirementList(deployment.secretRequirements)),
        ],
        ...[
          "    runtime_config_requirements =",
          ...renderStringRecordList(renderRequirementList(deployment.runtimeConfigRequirements)),
        ],
        ...(deployment.releaseActions.length > 0
          ? [
              `    release_actions = ${renderStringList(deployment.releaseActions.map((action) => action.ref))},`,
            ]
          : []),
        ...(deployment.targetExceptions.length > 0
          ? [
              `    target_exceptions = ${renderStringList(
                deployment.targetExceptions.map((exception) => exception.ref),
              )},`,
            ]
          : []),
        ...renderSmokeLines(deployment.smoke),
        ...renderBootstrapLines(deployment),
        ")",
        "",
      ],
    });
  }
  await writeTargetsFragments(workspaceRoot, fragments);
  await synchronizeInstalledDeployments(workspaceRoot, deployments);
}

export async function installKubernetesTargets(
  workspaceRoot: string,
  deployments: KubernetesDeployment[],
): Promise<void> {
  synchronizeGovernanceChecks(deployments);
  await installAppTargetsForDeployments(workspaceRoot, deployments);
  const fragments = sharedPolicyTargetsByDir(deployments);
  for (const deployment of deployments) {
    appendTargetsFragment(fragments, labelDir(deployment.label), {
      loadLines: ['load("//build-tools/deployments:defs.bzl", "deployment_target")'],
      bodyLines: [
        "deployment_target(",
        `    name = ${JSON.stringify(labelName(deployment.label))},`,
        '    provider = "kubernetes",',
        `    component = ${JSON.stringify(deployment.component.target)},`,
        `    component_kind = ${JSON.stringify(deployment.component.kind)},`,
        `    publisher = ${JSON.stringify(deployment.publisher.type)},`,
        `    publisher_config = ${JSON.stringify(deployment.publisher.config)},`,
        ...(deployment.provisioner
          ? [
              `    provisioner = ${JSON.stringify(deployment.provisioner.type)},`,
              `    provisioner_config = ${JSON.stringify(deployment.provisioner.config || "")},`,
            ]
          : []),
        `    protection_class = ${JSON.stringify(deployment.protectionClass)},`,
        `    lane_policy = ${JSON.stringify(deployment.lanePolicyRef)},`,
        `    environment_stage = ${JSON.stringify(deployment.environmentStage)},`,
        `    admission_policy = ${JSON.stringify(deployment.admissionPolicyRef)},`,
        "    components = [",
        ...deployment.components.flatMap((component) => [
          "        {",
          `            "id": ${JSON.stringify(component.id)},`,
          `            "kind": ${JSON.stringify(component.kind)},`,
          `            "target": ${JSON.stringify(component.target)},`,
          "        },",
        ]),
        "    ],",
        ...(deployment.rolloutPolicy
          ? [
              "    rollout_policy = {",
              `        "mode": ${JSON.stringify(deployment.rolloutPolicy.mode)},`,
              `        "abort": ${JSON.stringify(deployment.rolloutPolicy.abort)},`,
              `        "smoke": ${JSON.stringify(deployment.rolloutPolicy.smoke)},`,
              "    },",
              `    rollout_steps = ${renderStringList(deployment.rolloutPolicy.steps)},`,
            ]
          : []),
        "    provider_target = {",
        `        "cluster": ${JSON.stringify(deployment.providerTarget.cluster)},`,
        `        "namespace": ${JSON.stringify(deployment.providerTarget.namespace)},`,
        `        "release": ${JSON.stringify(deployment.providerTarget.release)},`,
        `        "id": ${JSON.stringify(deployment.providerTarget.id)},`,
        "    },",
        ...["    prerequisites =", ...renderStringRecordList(renderPrerequisiteList(deployment))],
        ...[
          "    secret_requirements =",
          ...renderStringRecordList(renderRequirementList(deployment.secretRequirements)),
        ],
        ...[
          "    runtime_config_requirements =",
          ...renderStringRecordList(renderRequirementList(deployment.runtimeConfigRequirements)),
        ],
        ...renderSmokeLines(deployment.smoke),
        ")",
        "",
      ],
    });
  }
  await writeTargetsFragments(workspaceRoot, fragments);
  await synchronizeInstalledDeployments(workspaceRoot, deployments);
}

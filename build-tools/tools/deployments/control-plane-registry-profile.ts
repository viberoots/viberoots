export const CONTROL_PLANE_REGISTRY_PROFILE_SCHEMA = "control-plane-registry-profile@1";

export type ControlPlaneRegistryProfile = {
  schemaVersion: typeof CONTROL_PLANE_REGISTRY_PROFILE_SCHEMA;
  mode: "aws-ecr" | "imported";
  repository: string;
  checkedAt: string;
  identity: {
    accountId?: string;
    region?: string;
    repositoryArn?: string;
    repositoryUri?: string;
    reviewedReference?: string;
  };
  immutability: {
    status: "immutable-tags" | "equivalent-mutation-prevention";
    evidence: string;
  };
  lifecyclePolicy: {
    status: "configured";
    evidence: string;
    ruleCount: number;
  };
  scanning:
    | { status: "enabled"; evidence: string }
    | { status: "reviewed-exception"; exceptionId: string; reviewedBy: string; reason: string };
  runtimePull: {
    principal: string;
    evidence: string;
    credentialSource: "ec2-instance-profile" | "reviewed-registry-credential-source";
    proof: RuntimePullProof;
  };
  publish: {
    principal: string;
    evidence: string;
  };
};

export type RuntimePullProof = {
  hostProfile: string;
  image: string;
  digest: string;
  checkedAt: string;
  principal: string;
  evidence: string;
};

export type ControlPlaneRegistryProfileValidationOptions = {
  expectedImageRef?: string;
  expectedDigest?: string;
  expectedHostProfile?: string;
};

const REPOSITORY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/;
const SECRET_PATTERN =
  /authorization\s*[:=]|bearer\s+\S+|cookie\s*[:=]|password\s*[:=]|private[_-]?key\s*[:=]|secret\s*[:=]|token\s*[:=]|api[_-]?key\s*[:=]|-----begin/i;

export function validateControlPlaneRegistryProfile(
  profile: ControlPlaneRegistryProfile | undefined,
  opts: ControlPlaneRegistryProfileValidationOptions = {},
): string[] {
  if (!profile) return ["control-plane registry profile is required"];
  const errors: string[] = [];
  if (profile.schemaVersion !== CONTROL_PLANE_REGISTRY_PROFILE_SCHEMA) {
    errors.push("control-plane registry profile schema is unsupported");
  }
  if (profile.mode !== "aws-ecr" && profile.mode !== "imported") {
    errors.push(
      `control-plane registry profile mode ${profile.mode || "<missing>"} is unsupported`,
    );
  }
  if (!REPOSITORY_PATTERN.test(profile.repository || "")) {
    errors.push("control-plane registry profile repository must be a tagless registry repository");
  }
  if (/[@:][^/]*$/.test((profile.repository || "").replace(/^[^/]+/, ""))) {
    errors.push("control-plane registry profile repository must not include a tag or digest");
  }
  if (!Number.isFinite(Date.parse(profile.checkedAt || ""))) {
    errors.push("control-plane registry profile checkedAt is missing or invalid");
  }
  errors.push(...validateIdentity(profile));
  errors.push(...validatePolicy(profile));
  errors.push(...validatePermissions(profile, opts));
  const unsafe = unsafeEvidencePath(profile);
  if (unsafe)
    errors.push(`control-plane registry profile contains unsafe credential content at ${unsafe}`);
  return errors;
}

export function assertControlPlaneRegistryProfile(profile: ControlPlaneRegistryProfile): void {
  const errors = validateControlPlaneRegistryProfile(profile);
  if (errors.length > 0) throw new Error(errors.join("; "));
}

export function registryProfileSummary(profile: ControlPlaneRegistryProfile) {
  assertControlPlaneRegistryProfile(profile);
  return {
    mode: profile.mode,
    repository: profile.repository,
    identity: profile.identity,
    immutability: profile.immutability.status,
    lifecyclePolicy: profile.lifecyclePolicy.status,
    scanning: profile.scanning.status,
    runtimePull: {
      principal: profile.runtimePull.principal,
      credentialSource: profile.runtimePull.credentialSource,
    },
    publishPrincipal: profile.publish.principal,
    checkedAt: profile.checkedAt,
  };
}

function validateIdentity(profile: ControlPlaneRegistryProfile): string[] {
  const errors: string[] = [];
  if (profile.mode === "aws-ecr") {
    if (!/^\d{12}$/.test(profile.identity?.accountId || "")) {
      errors.push("AWS ECR registry profile requires a 12 digit account id");
    }
    if (!/^[a-z]{2}-[a-z]+-\d$/.test(profile.identity?.region || "")) {
      errors.push("AWS ECR registry profile requires an AWS region");
    }
    if (!String(profile.identity?.repositoryArn || "").startsWith("arn:aws:ecr:")) {
      errors.push("AWS ECR registry profile requires repository ARN evidence");
    }
    if (!profile.identity?.repositoryUri) {
      errors.push("AWS ECR registry profile requires repository URI evidence");
    }
  }
  if (profile.mode === "imported" && !profile.identity?.reviewedReference) {
    errors.push("imported registry profile requires reviewed registry identity evidence");
  }
  return errors;
}

function validatePolicy(profile: ControlPlaneRegistryProfile): string[] {
  const errors: string[] = [];
  if (
    profile.immutability?.status !== "immutable-tags" &&
    profile.immutability?.status !== "equivalent-mutation-prevention"
  ) {
    errors.push("registry profile requires immutable tag policy or equivalent proof");
  }
  if (!profile.immutability?.evidence)
    errors.push("registry profile missing immutability evidence");
  if (
    profile.lifecyclePolicy?.status !== "configured" ||
    profile.lifecyclePolicy.ruleCount < 1 ||
    !profile.lifecyclePolicy.evidence
  ) {
    errors.push("registry profile requires configured lifecycle policy evidence");
  }
  if (profile.scanning?.status === "enabled" && !profile.scanning.evidence) {
    errors.push("registry profile requires enabled image scanning evidence");
  }
  if (
    profile.scanning?.status === "reviewed-exception" &&
    (!profile.scanning.exceptionId || !profile.scanning.reviewedBy || !profile.scanning.reason)
  ) {
    errors.push("image scanning exception requires reviewed exception metadata");
  } else if (
    profile.scanning?.status !== "enabled" &&
    profile.scanning?.status !== "reviewed-exception"
  ) {
    errors.push("registry profile requires image scanning or a reviewed exception");
  }
  return errors;
}

function validatePermissions(
  profile: ControlPlaneRegistryProfile,
  opts: ControlPlaneRegistryProfileValidationOptions,
): string[] {
  const errors: string[] = [];
  if (!profile.runtimePull?.principal || !profile.runtimePull.evidence) {
    errors.push("registry profile requires runtime pull permission evidence");
  }
  if (!profile.publish?.principal || !profile.publish.evidence) {
    errors.push("registry profile requires publish permission evidence");
  }
  if (profile.runtimePull?.principal === profile.publish?.principal) {
    errors.push("registry profile must separate runtime pull and publish principals");
  }
  if (
    profile.mode === "aws-ecr" &&
    profile.runtimePull?.credentialSource !== "ec2-instance-profile"
  ) {
    errors.push("AWS ECR runtime pull must use EC2 instance-profile evidence");
  }
  errors.push(...validateRuntimePullProof(profile, opts));
  return errors;
}

function validateRuntimePullProof(
  profile: ControlPlaneRegistryProfile,
  opts: ControlPlaneRegistryProfileValidationOptions,
): string[] {
  const proof = profile.runtimePull?.proof;
  if (!proof) return ["registry profile requires runtime pull proof"];
  const errors: string[] = [];
  if (!proof.hostProfile) errors.push("registry runtime pull proof requires host profile");
  if (!/^sha256:[a-f0-9]{64}$/.test(proof.digest || "")) {
    errors.push("registry runtime pull proof requires sha256 digest");
  }
  if (!Number.isFinite(Date.parse(proof.checkedAt || ""))) {
    errors.push("registry runtime pull proof checkedAt is missing or invalid");
  }
  if (!proof.evidence) errors.push("registry runtime pull proof requires evidence");
  if (proof.principal !== profile.runtimePull.principal) {
    errors.push("registry runtime pull proof principal must match runtime pull principal");
  }
  if (opts.expectedImageRef && proof.image !== opts.expectedImageRef) {
    errors.push("registry runtime pull proof image does not match selected image");
  }
  if (opts.expectedDigest && proof.digest !== opts.expectedDigest) {
    errors.push("registry runtime pull proof digest does not match selected image digest");
  }
  if (opts.expectedHostProfile && proof.hostProfile !== opts.expectedHostProfile) {
    errors.push("registry runtime pull proof host profile does not match selected host");
  }
  return errors;
}

function unsafeEvidencePath(value: unknown, path = "$"): string | undefined {
  if (typeof value === "string") return SECRET_PATTERN.test(value) ? path : undefined;
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const unsafe = unsafeEvidencePath(value[index], `${path}[${index}]`);
      if (unsafe) return unsafe;
    }
    return undefined;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = /^[A-Za-z_$][\w$]*$/.test(key)
      ? `${path}.${key}`
      : `${path}[${JSON.stringify(key)}]`;
    const unsafe = unsafeEvidencePath(child, childPath);
    if (unsafe) return unsafe;
  }
  return undefined;
}

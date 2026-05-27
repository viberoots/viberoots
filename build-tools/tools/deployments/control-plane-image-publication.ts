export type ControlPlaneImagePublicationInput = {
  repository: string;
  sourceRevision: string;
  imageBuildIdentity: string;
  digest: string;
  inspectedDigest: string;
  imageTarball: string;
  tag?: string;
};

export type ControlPlaneImagePublicationPlan = {
  repository: string;
  sourceRevision: string;
  digest: string;
  tagRef: string;
  digestRef: string;
  manifest: {
    image: string;
    sourceRevision: string;
    imageBuildIdentity: string;
    digest: string;
    inspectedDigest: string;
    tag: string;
  };
  commands: string[];
};

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

export function controlPlaneImagePublicationPlan(
  input: ControlPlaneImagePublicationInput,
): ControlPlaneImagePublicationPlan {
  const repository = cleanRepository(input.repository);
  const sourceRevision = required("sourceRevision", input.sourceRevision);
  const imageBuildIdentity = cleanImageBuildIdentity(input.imageBuildIdentity);
  const digest = required("digest", input.digest).toLowerCase();
  const inspectedDigest = required("inspectedDigest", input.inspectedDigest).toLowerCase();
  const imageTarball = required("imageTarball", input.imageTarball);
  if (!DIGEST_PATTERN.test(digest)) {
    throw new Error("published control-plane image digest must be sha256:<64 lowercase hex>");
  }
  if (!DIGEST_PATTERN.test(inspectedDigest)) {
    throw new Error("inspected control-plane image digest must be sha256:<64 lowercase hex>");
  }
  if (inspectedDigest !== digest) {
    throw new Error("published control-plane image digest must match registry inspect evidence");
  }
  const tag = cleanTag(input.tag || sourceRevision);
  const tagRef = `${repository}:${tag}`;
  const digestRef = `${repository}@${digest}`;
  const manifest = {
    image: digestRef,
    sourceRevision,
    imageBuildIdentity,
    digest,
    inspectedDigest,
    tag: tagRef,
  };
  return {
    repository,
    sourceRevision,
    digest,
    tagRef,
    digestRef,
    manifest,
    commands: [
      `skopeo copy docker-archive:${shellQuote(imageTarball)} docker://${tagRef}`,
      `skopeo inspect --format '{{.Digest}}' docker://${tagRef}`,
      `test "$(skopeo inspect --format '{{.Digest}}' docker://${tagRef})" = "${digest}"`,
      `printf '%s\\n' ${shellQuote(JSON.stringify(manifest))}`,
    ],
  };
}

export function assertControlPlaneImageDigestReference(imageRef: string): string {
  const value = required("imageRef", imageRef);
  if (!/@sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error("production control-plane image reference must be pinned by @sha256 digest");
  }
  return value;
}

function cleanRepository(value: string): string {
  const repository = required("repository", value);
  if (repository.includes("@") || /:[^/]+$/.test(repository)) {
    throw new Error("control-plane image repository must not include a tag or digest");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/.test(repository)) {
    throw new Error("control-plane image repository is not a valid registry repository");
  }
  return repository.replace(/\/+$/, "");
}

function cleanTag(value: string): string {
  const tag = required("tag", value);
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) {
    throw new Error("control-plane image convenience tag is not a valid OCI tag");
  }
  if (tag === "latest") {
    throw new Error("control-plane image convenience tag must not be latest");
  }
  return tag;
}

function cleanImageBuildIdentity(value: string): string {
  const identity = required("imageBuildIdentity", value);
  if (DIGEST_PATTERN.test(identity)) {
    throw new Error("image build identity must not masquerade as a verified OCI digest");
  }
  if (!/^nix-source-[a-f0-9]{64}$/.test(identity)) {
    throw new Error("image build identity must be nix-source-<64 lowercase hex>");
  }
  return identity;
}

function required(name: string, value: string): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) throw new Error(`control-plane image publication requires ${name}`);
  return trimmed;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

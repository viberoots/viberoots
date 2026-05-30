import type { CloudControlSetupInput } from "./cloud-control-setup-types";

export function imagePublicationCommand(
  input: CloudControlSetupInput,
  rootPrelude: string,
): string {
  const evidence = input.imagePublication!;
  const args = [
    '--registry-profile "$PROFILE_ROOT/registry-profile.json"',
    `--image ${shellQuote(input.image)}`,
    `--source-revision ${shellQuote(evidence.sourceRevision)}`,
    `--image-build-identity ${shellQuote(evidence.imageBuildIdentity)}`,
    `--published-digest ${shellQuote(evidence.digest)}`,
    `--tag ${shellQuote(evidence.tag.split(":").at(-1) || evidence.sourceRevision)}`,
    '--out "$PROFILE_ROOT/image-publication.json"',
  ];
  return `${rootPrelude}; deployment-control-plane image-publication ${args.join(" ")}`;
}

export function imagePublicationInputs(input: CloudControlSetupInput): string[] {
  return input.imagePublication?.registryProfile
    ? ["$PROFILE_ROOT/registry-profile.json"]
    : ["reviewed registry profile"];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

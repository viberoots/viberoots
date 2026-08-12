export const REVIEWED_REQUIRED_SUBSTITUTERS = [
  "https://cache.nixos.org/",
  "https://install.determinate.systems",
] as const;

export const REVIEWED_OPTIONAL_SUBSTITUTERS = ["https://cache.home.kilty.io/main"] as const;

export const REVIEWED_SUBSTITUTERS = [
  ...REVIEWED_REQUIRED_SUBSTITUTERS,
  ...REVIEWED_OPTIONAL_SUBSTITUTERS,
] as const;

export const REVIEWED_EVIDENCE_PUBLIC_KEY =
  "main:N7uIAritMCBWpa9cdZJxHJ7gWfsXCwAsbyIJqrSQnLY=" as const;
export const REVIEWED_EVIDENCE_SIGNER_IDENTITY = "nix:main" as const;
export const REVIEWED_NIX_EXPERIMENTAL_FEATURES = "nix-command flakes" as const;

export function reviewedArtifactSandboxPaths(
  platform: NodeJS.Platform = process.platform,
): readonly string[] {
  return platform === "darwin" ? ["/bin/bash"] : [];
}

export const REVIEWED_PUBLIC_KEYS = [
  "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY=",
  REVIEWED_EVIDENCE_PUBLIC_KEY,
  "cache.flakehub.com-3:hJuILl5sVK4iKm86JzgdXW12Y2Hwd5G07qKtHTOcDCM=",
  "cache.flakehub.com-4:Asi8qIv291s0aYLyH6IOnr5Kf6+OF14WVjkE6t3xMio=",
  "cache.flakehub.com-5:zB96CRlL7tiPtzA9/WKyPkp3A2vqxqgdgyTVNGShPDU=",
  "cache.flakehub.com-6:W4EGFwAGgBj3he7c5fNh9NkOXw0PUVaxygCVKeuvaqU=",
  "cache.flakehub.com-7:mvxJ2DZVHn/kRxlIaxYNMuDG1OvMckZu32um1TadOR8=",
  "cache.flakehub.com-8:moO+OVS0mnTjBTcOUh2kYLQEd59ExzyoW1QgQ8XAARQ=",
  "cache.flakehub.com-9:wChaSeTI6TeCuV/Sg2513ZIM9i0qJaYsF+lZCXg0J6o=",
  "cache.flakehub.com-10:2GqeNlIp6AKp4EF2MVbE1kBOp9iBSyo0UPR9KoR0o1Y=",
] as const;

export function artifactNixExperimentalFeatureArgs(): string[] {
  return ["--extra-experimental-features", REVIEWED_NIX_EXPERIMENTAL_FEATURES];
}

export function artifactNixScopedPolicyArgs(opts?: {
  allowReviewedRemoteBuilders?: boolean;
}): string[] {
  return [
    ...artifactNixExperimentalFeatureArgs(),
    "--option",
    "sandbox",
    "true",
    "--option",
    "sandbox-fallback",
    "false",
    "--option",
    "sandbox-paths",
    reviewedArtifactSandboxPaths().join(" "),
    "--option",
    "extra-sandbox-paths",
    "",
    ...(opts?.allowReviewedRemoteBuilders ? [] : ["--option", "builders", ""]),
    "--option",
    "trusted-public-keys",
    REVIEWED_PUBLIC_KEYS.join(" "),
  ];
}

export function artifactNixIndependentPolicyArgs(
  cachePolicy: "reviewed" | "empty",
  opts?: { allowReviewedRemoteBuilders?: boolean },
): string[] {
  const required = cachePolicy === "reviewed" ? REVIEWED_REQUIRED_SUBSTITUTERS.join(" ") : "";
  return [
    ...artifactNixScopedPolicyArgs(opts),
    "--option",
    "substituters",
    required,
    "--option",
    "extra-substituters",
    "",
    "--option",
    "fallback",
    "true",
  ];
}

/** Commands under a cache-health command scope inherit its exact reviewed NIX_CONFIG. */
export const artifactNixPolicyArgs = artifactNixScopedPolicyArgs;

export function artifactNixPolicyConfigArgs(): string[] {
  return [...artifactNixScopedPolicyArgs(), "config", "show", "--json"];
}

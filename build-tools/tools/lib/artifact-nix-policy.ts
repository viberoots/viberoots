export const REVIEWED_SUBSTITUTERS = [
  "https://cache.nixos.org/",
  "https://cache.home.kilty.io/main",
  "https://install.determinate.systems",
] as const;

export const REVIEWED_EVIDENCE_PUBLIC_KEY =
  "main:N7uIAritMCBWpa9cdZJxHJ7gWfsXCwAsbyIJqrSQnLY=" as const;
export const REVIEWED_EVIDENCE_SIGNER_IDENTITY = "nix:main" as const;

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

export function artifactNixPolicyArgs(opts?: { allowReviewedRemoteBuilders?: boolean }): string[] {
  return [
    "--option",
    "sandbox",
    "true",
    "--option",
    "sandbox-fallback",
    "false",
    "--option",
    "sandbox-paths",
    "",
    "--option",
    "extra-sandbox-paths",
    "",
    ...(opts?.allowReviewedRemoteBuilders ? [] : ["--option", "builders", ""]),
    "--option",
    "substituters",
    REVIEWED_SUBSTITUTERS.join(" "),
    "--option",
    "trusted-public-keys",
    REVIEWED_PUBLIC_KEYS.join(" "),
  ];
}

export function artifactNixPolicyConfigArgs(): string[] {
  return [...artifactNixPolicyArgs(), "config", "show", "--json"];
}

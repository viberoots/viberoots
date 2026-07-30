import { config, reviewedCsp } from "./rust.tauri-policy.fixture";

type PolicyCase = [string, Record<string, unknown>, Record<string, unknown>?, string?];

export const rejectedPolicies: PolicyCase[] = [
  [
    "wildcard CSP",
    config({ app: { security: { csp: "default-src *", capabilities: ["default"] } } }),
  ],
  [
    "unsafe-inline CSP",
    config({
      app: {
        security: { csp: "default-src 'self' 'unsafe-inline'", capabilities: ["default"] },
      },
    }),
  ],
  [
    "unsafe-eval CSP",
    config({
      app: {
        security: { csp: "default-src 'self' 'unsafe-eval'", capabilities: ["default"] },
      },
    }),
  ],
  [
    "network URL",
    config({ build: { frontendDist: "frontend-dist", devUrl: "https://example.com" } }),
  ],
  [
    "hidden hook",
    config({
      build: { frontendDist: "frontend-dist", beforeBuildCommand: "curl example.com" },
    }),
  ],
  ["plugin config", config({ plugins: { shell: {} } })],
  [
    "global API enabled",
    config({
      app: {
        withGlobalTauri: true,
        security: { csp: reviewedCsp, capabilities: ["default"] },
        windows: [{ label: "main" }],
      },
    }),
  ],
  [
    "unreviewed window label",
    config({
      app: {
        withGlobalTauri: false,
        security: { csp: reviewedCsp, capabilities: ["default"] },
        windows: [{ label: "secondary" }],
      },
    }),
  ],
  [
    "ad-hoc signing identity",
    config({
      bundle: {
        icon: ["icons/icon.png"],
        resources: { "help.txt": "help/help.txt" },
        macOS: { signingIdentity: "-" },
      },
    }),
  ],
  [
    "named signing identity",
    config({
      bundle: {
        icon: ["icons/icon.png"],
        resources: { "help.txt": "help/help.txt" },
        macOS: { signingIdentity: "Developer ID Application" },
      },
    }),
  ],
  [
    "signing entitlements",
    config({
      bundle: {
        icon: ["icons/icon.png"],
        resources: { "help.txt": "help/help.txt" },
        macOS: { entitlements: "Entitlements.plist" },
      },
    }),
  ],
  [
    "undeclared sidecar",
    config({
      bundle: {
        icon: ["icons/icon.png"],
        resources: { "help.txt": "help/help.txt" },
        externalBin: ["tool"],
      },
    }),
  ],
  [
    "resource mismatch",
    config({
      bundle: { icon: ["icons/icon.png"], resources: { "other.txt": "help/help.txt" } },
    }),
  ],
  [
    "icon mismatch",
    config({
      bundle: { icon: ["icons/other.png"], resources: { "help.txt": "help/help.txt" } },
    }),
  ],
  ["frontend mismatch", config({ build: { frontendDist: "dist" } })],
  [
    "powerful permission",
    config(),
    { identifier: "default", permissions: ["shell:allow-execute"] },
  ],
  ["wildcard permission", config(), { identifier: "default", permissions: ["core:*"] }],
  [
    "capability window mismatch",
    config(),
    { identifier: "default", permissions: ["core:default"], windows: ["secondary"] },
  ],
  ["plugin dependency", config(), undefined, 'name = "tauri-plugin-shell"\nversion = "2.0.0"\n'],
];

export const mainCapability = {
  identifier: "main",
  permissions: ["core:default", "allow-report-status"],
  windows: ["main"],
};

export const popupCapability = {
  identifier: "auth-popup",
  permissions: [],
  windows: ["auth-popup"],
};

export const exactPermission =
  '[[permission]]\nidentifier = "allow-report-status"\ncommands.allow = ["report_status"]\n';

export const rejectedPermissionMappings: ReadonlyArray<readonly [string, string]> = [
  [
    "mismatched command",
    '[[permission]]\nidentifier = "allow-report-status"\ncommands.allow = ["other_status"]\n',
  ],
  [
    "denied command",
    '[[permission]]\nidentifier = "allow-report-status"\ncommands.allow = ["report_status"]\ncommands.deny = ["other_status"]\n',
  ],
  [
    "wildcard command",
    '[[permission]]\nidentifier = "allow-report-status"\ncommands.allow = ["*"]\n',
  ],
  [
    "extra allowed command",
    '[[permission]]\nidentifier = "allow-report-status"\ncommands.allow = ["report_status", "other_status"]\n',
  ],
  ["duplicate permission", `${exactPermission}${exactPermission}`],
  [
    "extra permission",
    `${exactPermission}[[permission]]\nidentifier = "allow-other-status"\ncommands.allow = ["other_status"]\n`,
  ],
];

export const rejectedCapabilityMappings: ReadonlyArray<
  readonly [string, Record<string, unknown>, Record<string, unknown>]
> = [
  [
    "duplicate permission",
    { ...mainCapability, permissions: ["allow-report-status", "allow-report-status"] },
    popupCapability,
  ],
  ["duplicate window coverage", mainCapability, { ...popupCapability, windows: ["main"] }],
  ["duplicate capability identifier", mainCapability, { ...popupCapability, identifier: "main" }],
  ["undeclared window", mainCapability, { ...popupCapability, windows: ["future-window"] }],
  [
    "undeclared command permission",
    { ...mainCapability, permissions: ["core:default", "allow-future-command"] },
    popupCapability,
  ],
  [
    "plugin permission",
    { ...mainCapability, permissions: ["core:default", "shell:allow-execute"] },
    popupCapability,
  ],
  [
    "future core permission",
    { ...mainCapability, permissions: ["core:default", "core:future"] },
    popupCapability,
  ],
];

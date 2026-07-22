export const reviewedRootCommandSiteFixtureRules = [
  {
    pathPattern:
      "^(?:Jenkinsfile|flake\\.nix|\\.buck2_env\\.sh|\\.buck2_shim/bin/buck2|third_party/uv2nix/flake\\.nix)$",
    role: "canonical-artifact" as const,
    justification: "Seeded root CI, Buck, and third-party artifact authorities.",
  },
  {
    pathPattern: "^\\.envrc$",
    role: "non-artifact-orchestration" as const,
    justification: "Seeded root developer-shell entrypoint.",
  },
  {
    pathPattern: "^(?:\\.husky/pre-commit|bootstrap|init|post-clone)$",
    role: "update-install" as const,
    justification: "Seeded root hook, bootstrap, and initialization entrypoints.",
  },
] as const;

export const starlarkApi = `# Starlark API reference

## Index

- \`@viberoots//build-tools/go:defs.bzl\`
  - \`nix_go_library\`
  - \`nix_go_binary\`
- \`@viberoots//build-tools/node:defs.bzl\`
  - \`nix_node_gen\`
  - \`nix_node_lib\`
  - \`node_webapp\`

## Go macros
`;

export const nixGapsComplete = `# Nix gaps (public macro inventory)

## Legend

- **Nix build** means the macro calls Nix or a Nix-backed rule.
- **Buck build** means the macro produces artifacts through Buck rules and is still a migration gap.
- **Stub (artifact expected)** means the macro contract expects a build artifact, but the current implementation is still a stub.
- **Probe-only exception** means the macro is intentionally non-build and does not produce a production artifact.

## Go macros

- \`nix_go_library\` → Nix build (\`graph-generator-selected\`).
- \`nix_go_binary\` → Nix build (\`graph-generator-selected\`).

## Node macros

- \`nix_node_gen\` → Nix build (\`graph-generator-selected\`).
- \`nix_node_lib\` → Nix build (\`graph-generator-selected\`).
- \`node_webapp\` → Nix build (\`nix build\`).

Node macro outcome classification:

| Macro | Outcome category | Current route | Notes |
| ----- | ---------------- | ------------- | ----- |
| \`nix_node_gen\` | artifact-producing | Nix build | migrated |
| \`nix_node_lib\` | artifact-producing | Nix build | migrated |
| \`node_webapp\` | orchestration wrapper | Nix build | wrapper |

## Exception policy (intentional non-build macros)

- \`cpp_sanitize_probe\` (test probe only, no production artifact contract).
`;

export const nixGapsMissing = `# Nix gaps (public macro inventory)

## Legend

- **Nix build** means the macro calls Nix or a Nix-backed rule.
- **Buck build** means the macro produces artifacts through Buck rules and is still a migration gap.
- **Stub (artifact expected)** means the macro contract expects a build artifact, but the current implementation is still a stub.
- **Probe-only exception** means the macro is intentionally non-build and does not produce a production artifact.

## Go macros

- \`nix_go_library\` → Buck build (\`go_library\`).

## Node macros

- \`nix_node_gen\` → Buck build (\`genrule\`).
- \`nix_node_lib\` → Buck build (\`genrule\`).
- \`node_webapp\` → Nix build (\`nix build\`).

Node macro outcome classification:

| Macro | Outcome category | Current route | Notes |
| ----- | ---------------- | ------------- | ----- |
| \`nix_node_gen\` | artifact-producing | Buck build | gap |
| \`nix_node_lib\` | artifact-producing | Buck build | gap |
| \`node_webapp\` | orchestration wrapper | Nix build | wrapper |

## Exception policy (intentional non-build macros)

- \`cpp_sanitize_probe\` (test probe only, no production artifact contract).
`;

export const nixGapsMissingNodeClassification = `# Nix gaps (public macro inventory)

## Legend

- **Nix build** means the macro calls Nix or a Nix-backed rule.
- **Buck build** means the macro produces artifacts through Buck rules and is still a migration gap.
- **Stub (artifact expected)** means the macro contract expects a build artifact, but the current implementation is still a stub.
- **Probe-only exception** means the macro is intentionally non-build and does not produce a production artifact.

## Go macros

- \`nix_go_library\` → Buck build (\`go_library\`).
- \`nix_go_binary\` → Buck build (\`go_binary\`).

## Node macros

- \`nix_node_gen\` → Buck build (\`genrule\`).
- \`nix_node_lib\` → Buck build (\`genrule\`).
- \`node_webapp\` → Nix build (\`nix build\`).

Node macro outcome classification:

| Macro | Outcome category | Current route | Notes |
| ----- | ---------------- | ------------- | ----- |
| \`nix_node_gen\` | artifact-producing | Buck build | gap |
| \`nix_node_lib\` | artifact-producing | Buck build | gap |

## Exception policy (intentional non-build macros)

- \`cpp_sanitize_probe\` (test probe only, no production artifact contract).
`;

export const nixGapsMissingExceptionPolicy = `# Nix gaps (public macro inventory)

## Legend

- **Nix build** means the macro calls Nix or a Nix-backed rule.
- **Buck build** means the macro produces artifacts through Buck rules and is still a migration gap.
- **Stub (artifact expected)** means the macro contract expects a build artifact, but the current implementation is still a stub.
- **Probe-only exception** means the macro is intentionally non-build and does not produce a production artifact.

## Go macros

- \`nix_go_library\` → Buck build (\`go_library\`).
- \`nix_go_binary\` → Buck build (\`go_binary\`).

## Node macros

- \`nix_node_gen\` → Buck build (\`genrule\`).
- \`nix_node_lib\` → Buck build (\`genrule\`).
- \`node_webapp\` → Nix build (\`nix build\`).

Node macro outcome classification:

| Macro | Outcome category | Current route | Notes |
| ----- | ---------------- | ------------- | ----- |
| \`nix_node_gen\` | artifact-producing | Buck build | gap |
| \`nix_node_lib\` | artifact-producing | Buck build | gap |
| \`node_webapp\` | orchestration wrapper | Nix build | wrapper |
`;

export const exceptionsComplete = `{
  "exceptions": [
    {
      "macro": "cpp_sanitize_probe",
      "kind": "probe-only",
      "justification": "Test-only sanitizer probe with no production artifact contract."
    }
  ]
}
`;

export const exceptionsMissingJustification = `{
  "exceptions": [
    {
      "macro": "cpp_sanitize_probe",
      "kind": "probe-only",
      "justification": ""
    }
  ]
}
`;

export const goDefsFixture = `def nix_go_library(name, **kwargs):
    pass

def nix_go_binary(name, **kwargs):
    pass
`;

export const nodeDefsFixture = `def nix_node_gen(name, **kwargs):
    pass

def nix_node_lib(name, **kwargs):
    pass

def node_webapp(name, **kwargs):
    pass
`;

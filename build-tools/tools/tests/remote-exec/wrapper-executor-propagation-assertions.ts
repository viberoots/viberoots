import assert from "node:assert/strict";

export const fixtureRoot = "viberoots//build-tools/tools/tests/remote-exec/wrapper-fixtures";
export const wrappers = ["zx", "node", "go", "python", "cpp", "rust"];

export function target(wrapper: string, mode: "local" | "remote"): string {
  return `${fixtureRoot}:${wrapper}_${mode}`;
}

export function readyTarget(wrapper: string): string {
  return `${fixtureRoot}:${wrapper}_ready_handles`;
}

export function expectProjectRelative(providerText: string): void {
  assert.match(providerText, /run_from_project_root=True/);
  assert.match(providerText, /use_project_relative_paths=True/);
}

export function expectLocalProvider(providerText: string): void {
  expectProjectRelative(providerText);
  assert.match(providerText, /default_executor=None/);
  assert.match(providerText, /executor_overrides={}/);
  assert.match(providerText, /"existing:label"/);
  assert.match(providerText, /"remote:local-only"/);
}

export function expectRemoteProvider(providerText: string): void {
  expectProjectRelative(providerText);
  assert.match(providerText, /default_executor=CommandExecutorConfig/);
  assert.match(providerText, /RemoteEnabledExecutorOptions/);
  assert.match(providerText, /RemoteExecutorUseCase[\s\S]*"buck2-test"/);
  assert.match(providerText, /"viberoots_remote_profile": "linux-x86_64-default"/);
  assert.match(providerText, /"resource_class": "default"/);
  assert.match(providerText, /executor_overrides=\{\s*"listing": CommandExecutorConfig/s);
  assert.match(providerText, /"existing:label"/);
  assert.match(providerText, /"remote:local-only"/);
}

function externalRunnerCommand(providerText: string): string {
  const match = providerText.match(
    /ExternalRunnerTestInfo\([\s\S]*?command=\[(?<body>[\s\S]*?)\],\n\s+env=/,
  );
  assert.ok(match?.groups?.body, "expected ExternalRunnerTestInfo command body");
  return match.groups.body;
}

export function expectDeclaredHandles(providerText: string, names: string[]): void {
  const command = externalRunnerCommand(providerText);
  const hidden = command.match(/hidden=\[(?<body>[\s\S]*?)\]/)?.groups?.body || "";
  assert.match(command, /cmd_args\(/);
  if (names.includes("remote-ready-runner.sh")) assert.match(command, /remote-ready-runner\.sh/);
  else assert.match(command, /remote-runner/);
  for (const name of names) assert.match(hidden, new RegExp(name.replace(".", "\\.")));
  const executableText = command.replace(/hidden=\[[\s\S]*?\]/g, "hidden=[]");
  assert.doesNotMatch(executableText, /WORKSPACE_ROOT|FLK_ROOT|BUCK_TEST_SRC|"[^"]*build-tools\//);
  assert.doesNotMatch(executableText, /"-c"/);
  const launcherText = executableText.match(/cmd_args\([\s\S]*?\),/)?.[0] || executableText;
  assert.doesNotMatch(
    launcherText,
    /command -v|\bbash\b|\bnode\b|\bnix\b|\btimeout\b|\bgit\b|\bfind\b/,
  );
}

const commonScriptHandles = [
  "fixture.txt",
  "remote-ready-runner.sh",
  "zx-init.mjs",
  "build-selected.ts",
  "graph.json",
  "workspace-root.env",
];

export const expectedReadyHandles = new Map<string, string[]>([
  [
    "zx",
    [
      "noop.test.ts",
      "fixture.txt",
      "zx_ready_source_snapshot.source-snapshot",
      "zx_ready_source_snapshot.source-snapshot.manifest.json",
      "materialization-manifest.json",
      "artifact-contract.json",
      "tool-closure.json",
      "remote-builder-smoke.json",
      "remote-ready-runner.sh",
      "zx-init.mjs",
      "command-heartbeat.ts",
      "node-modules-build.ts",
    ],
  ],
  [
    "node",
    [
      ...commonScriptHandles.map((name) =>
        name === "build-selected.ts" ? "nix-build-filtered-flake.ts" : name,
      ),
      "command-heartbeat.ts",
    ],
  ],
  ["go", commonScriptHandles],
  ["python", commonScriptHandles],
  ["cpp", commonScriptHandles],
  [
    "rust",
    [
      "graph.json",
      "rust_ready_source_snapshot.source-snapshot",
      "rust_ready_source_snapshot.source-snapshot.manifest.json",
      "materialization-manifest.json",
      "artifact-contract.json",
      "tool-closure.json",
      "remote-builder-smoke.json",
      "Cargo.toml",
      "Cargo.lock",
      "zx-init.mjs",
      "build-selected.ts",
      "validate-source-snapshot.ts",
      "workspace-root.env",
    ],
  ],
]);

#!/usr/bin/env zx-wrapper
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getFlagBool, getFlagStr, getPositionals } from "../lib/cli";
import { getArgvTokens } from "../lib/argv";
import { findExtractionBlockers } from "../lib/extraction-blockers";
import { resolveWorkspaceRootsSync } from "../lib/repo";
import { activateWorkspace } from "../lib/workspace-activation";
import { remoteSourceStatus } from "../lib/workspace-remote-source";
import { initConsumer } from "../lib/consumer-bootstrap";
import { checkBootstrapCompletion } from "../lib/bootstrap-completion";
import { removeSubmodule, useFlake, useSubmodule } from "../lib/consumer-source-mode";
import { runLiveBootstrap } from "../lib/live-bootstrap";
import { runViberootsGc } from "../lib/maintenance-gc";
import { repairGeneratedWorkspaceLock } from "../lib/workspace-lock-repair";

type VersionStatus = ReturnType<typeof buildVersionStatus>;
type CommandMeta = {
  name: string;
  usage: string;
  description: string;
  options: string[];
};

const commandMetadata: CommandMeta[] = [
  {
    name: "status",
    usage: "viberoots status [--json]",
    description: "Print active source mode and workspace status.",
    options: ["--json"],
  },
  {
    name: "develop",
    usage: "viberoots develop [--print] [nix-develop-args...]",
    description: "Enter the generated workspace dev shell with the selected viberoots input.",
    options: ["--print", "--verbose", "--help", "--command"],
  },
  {
    name: "bootstrap-check",
    usage:
      "viberoots bootstrap-check [--workspace-root <path>] [--repair-if-needed] [--verbose] [--json]",
    description: "Inspect or repair an incomplete bootstrap transaction.",
    options: ["--workspace-root", "--repair-if-needed", "--verbose", "--json", "--help"],
  },
  {
    name: "bootstrap",
    usage: "viberoots bootstrap [--mode flake|submodule] [--ref <ref>] [--dry-run]",
    description: "Run the latest live bootstrap script from GitHub main.",
    options: [
      "--mode",
      "--ref",
      "--workspace-root",
      "--run-install",
      "--no-run-install",
      "--run-validate",
      "--no-direnv-allow",
      "--dry-run",
      "--bootstrap-url",
      "--trust-bootstrap-url",
      "--help",
    ],
  },
  {
    name: "update",
    usage: "viberoots update [--mode flake|submodule] [--ref <ref>] [--dry-run]",
    description: "Alias for viberoots bootstrap; runs the latest live bootstrap script.",
    options: [
      "--mode",
      "--ref",
      "--workspace-root",
      "--run-install",
      "--no-run-install",
      "--run-validate",
      "--no-direnv-allow",
      "--dry-run",
      "--bootstrap-url",
      "--trust-bootstrap-url",
      "--help",
    ],
  },
  {
    name: "gc",
    usage: "viberoots gc [--dry-run] [--aggressive] [--optimize] [--nix|--no-nix] [--verbose]",
    description: "Conservatively clean Nix and viberoots-owned generated local state.",
    options: [
      "--dry-run",
      "--aggressive",
      "--optimize",
      "--nix",
      "--no-nix",
      "--nix-delete-older-than",
      "--keep-current-profile",
      "--verbose",
      "--workspace-root",
      "--help",
    ],
  },
  {
    name: "init-consumer",
    usage:
      "viberoots init-consumer --viberoots-url <flake-ref> [--mode flake|submodule] [--workspace-root <path>]",
    description: "Create or repair generated consumer workspace files.",
    options: [
      "--mode",
      "--workspace-root",
      "--workspace-name",
      "--viberoots-url",
      "--source",
      "--no-lock",
      "--no-direnv",
      "--setup-direnv",
      "--run-install",
      "--help",
    ],
  },
  {
    name: "use-submodule",
    usage: "viberoots use-submodule [--url <git-url>] [--trust-url] [--no-direnv] [--run-install]",
    description: "Switch this consumer workspace to local viberoots submodule mode.",
    options: ["--url", "--trust-url", "--no-direnv", "--run-install", "--workspace-root", "--help"],
  },
  {
    name: "use-flake",
    usage:
      "viberoots use-flake [--ref <tag-or-commit>] [--remove-submodule] [--no-direnv] [--run-install]",
    description: "Switch this consumer workspace to pinned flake source mode.",
    options: [
      "--ref",
      "--remove-submodule",
      "--no-direnv",
      "--run-install",
      "--workspace-root",
      "--help",
    ],
  },
  {
    name: "remove-submodule",
    usage: "viberoots remove-submodule [--dry-run]",
    description: "Remove an inactive viberoots submodule after strict safety checks.",
    options: ["--dry-run", "--workspace-root", "--help"],
  },
  {
    name: "completion",
    usage: "viberoots completion bash|zsh",
    description: "Print shell completion code.",
    options: ["bash", "zsh", "--help"],
  },
  {
    name: "help",
    usage: "viberoots help [command]",
    description: "Print command help.",
    options: [],
  },
];

function commandMeta(name: string): CommandMeta | undefined {
  return commandMetadata.find((command) => command.name === name);
}

function git(args: string[], cwd: string): string {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function checkedOutRevision(root: string): string {
  return git(["rev-parse", "HEAD"], root) || "unknown";
}

function lockedRevision(workspaceRoot: string): string {
  try {
    const lockPath = path.join(workspaceRoot, "flake.lock");
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    const nodes = lock?.nodes || {};
    const node = nodes.viberoots || nodes.viberootsInput;
    return String(node?.locked?.rev || "").trim();
  } catch {
    return "";
  }
}

function currentMatchesSource(currentPath: string, sourcePath: string): boolean {
  try {
    return fs.realpathSync(currentPath) === fs.realpathSync(sourcePath);
  } catch {
    return false;
  }
}

function revision(root: string, sourceMode: string, workspaceRoot: string) {
  const checkedOut = checkedOutRevision(root);
  if (checkedOut !== "unknown") return { value: checkedOut, source: "git" };
  if (sourceMode === "remote") {
    const locked = lockedRevision(workspaceRoot);
    if (locked) return { value: locked, source: "flake-lock" };
  }
  return { value: "unknown", source: "unknown" };
}

function dirtyState(root: string, sourceMode: string): string {
  if (sourceMode !== "local") return "not-applicable";
  const status = git(["status", "--porcelain=v1"], root);
  if (!status && checkedOutRevision(root) === "unknown") return "unknown";
  return status ? "dirty" : "clean";
}

function gitlinkRevision(workspaceRoot: string): string {
  const entry = git(["ls-files", "-s", "viberoots"], workspaceRoot);
  return entry.match(/^160000\s+([0-9a-f]{40})\s+/)?.[1] || "";
}

function submoduleState(workspaceRoot: string, viberootsRoot: string): string {
  const expected = gitlinkRevision(workspaceRoot);
  if (!expected) return "not-gitlink";
  const actual = checkedOutRevision(viberootsRoot);
  if (actual === "unknown") return "uninitialized";
  if (actual !== expected) return "gitlink-mismatch";
  return dirtyState(viberootsRoot, "local") === "dirty" ? "dirty" : "clean";
}

function currentDisplay(status: VersionStatus): string {
  if (status.currentStatus === "missing") return `${status.viberootsCurrent} (missing)`;
  if (status.viberootsCurrent === status.viberootsRoot) return status.viberootsCurrent;
  return `${status.viberootsCurrent} -> ${status.viberootsRoot}`;
}

function buildVersionStatus() {
  const roots = resolveWorkspaceRootsSync();
  const remote = roots.sourceMode === "remote" ? remoteSourceStatus(roots.workspaceRoot) : null;
  const resolvedRevision = revision(roots.viberootsRoot, roots.sourceMode, roots.workspaceRoot);
  const expectedRevision = gitlinkRevision(roots.workspaceRoot);
  return {
    sourceMode: roots.sourceMode,
    declaredVersion: process.env.VIBEROOTS_VERSION || "unknown",
    releaseTag: process.env.VIBEROOTS_RELEASE_TAG || "unknown",
    workspaceRoot: roots.workspaceRoot,
    viberootsRoot: roots.viberootsRoot,
    viberootsCurrent: roots.viberootsCurrent,
    viberootsWorkspace: roots.viberootsWorkspace,
    currentStatus: roots.currentStatus,
    revision: resolvedRevision.value,
    revisionSource: resolvedRevision.source,
    requestedRef: remote?.requestedRef || "unknown",
    lockedRevision: remote?.lockedRevision || "unknown",
    effectiveSourcePath: remote?.sourcePath || roots.viberootsRoot,
    currentMatchesLockedSource: remote
      ? currentMatchesSource(roots.viberootsCurrent, remote.sourcePath)
      : "not-applicable",
    expectedGitlinkRevision: expectedRevision || "unknown",
    submoduleState:
      roots.sourceMode === "local"
        ? submoduleState(roots.workspaceRoot, roots.viberootsRoot)
        : expectedRevision
          ? `inactive-${submoduleState(roots.workspaceRoot, path.join(roots.workspaceRoot, "viberoots"))}`
          : "not-applicable",
    dirtyState: dirtyState(roots.viberootsRoot, roots.sourceMode),
    currentPointsToLiveCheckout: roots.currentPointsToLiveCheckout,
    extractionBlockers: findExtractionBlockers(roots.workspaceRoot),
  };
}

function printText(status: VersionStatus): void {
  console.log(`source mode:    ${status.sourceMode}`);
  console.log(`workspace root: ${status.workspaceRoot}`);
  console.log(`viberoots root: ${status.viberootsRoot}`);
  console.log(`viberoots path: ${currentDisplay(status)}`);
  console.log(`workspace data: ${path.relative(status.workspaceRoot, status.viberootsWorkspace)}`);
  console.log(`version:        ${status.declaredVersion}`);
  console.log(`revision:       ${status.revision}`);
  console.log(`revision source: ${status.revisionSource}`);
  console.log(`requested ref:  ${status.requestedRef}`);
  console.log(`locked revision: ${status.lockedRevision}`);
  console.log(`effective source: ${status.effectiveSourcePath}`);
  console.log(`current locked: ${status.currentMatchesLockedSource}`);
  console.log(`gitlink:        ${status.expectedGitlinkRevision}`);
  console.log(`submodule:      ${status.submoduleState}`);
  console.log(`dirty state:    ${status.dirtyState}`);
  console.log(
    `local current:  ${status.currentPointsToLiveCheckout ? "live checkout" : "not live checkout"}`,
  );
  if (status.extractionBlockers.length > 0) {
    console.log("extraction blockers:");
    for (const blocker of status.extractionBlockers) {
      console.log(`  - ${blocker.kind}: ${blocker.path} - ${blocker.detail}`);
    }
  }
}

async function initWorkspace(): Promise<void> {
  const result = await activateWorkspace({
    sourcePath: getFlagStr("source"),
    shellEntry: getFlagBool("shell-entry"),
  });
  if (getFlagBool("json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`workspace root: ${result.workspaceRoot}`);
  console.log(`viberoots source: ${result.sourcePath}`);
  console.log(`current link: ${result.currentPath} -> ${result.currentTarget}`);
  console.log(
    `workspace data: ${path.relative(result.workspaceRoot, result.workspaceDirs[0] || "")}`,
  );
}

function printHelp(commandName?: string): void {
  if (commandName) {
    const command = commandMeta(commandName);
    if (!command) {
      console.error(`error: unknown command: ${commandName}`);
      console.error("run: viberoots help");
      process.exit(2);
    }
    console.log(command.usage);
    console.log(command.description);
    if (command.options.length) {
      console.log("options:");
      for (const option of command.options) console.log(`  ${option}`);
    }
    return;
  }
  console.log("viberoots commands:");
  for (const command of commandMetadata) {
    console.log(`  ${command.usage}`);
    console.log(`    ${command.description}`);
  }
}

function printBashCompletion(): void {
  const commandNames = commandMetadata.map((command) => command.name).join(" ");
  const optionCases = commandMetadata
    .map((command) => `    ${command.name}) opts="${command.options.join(" ")}" ;;`)
    .join("\n");
  console.log(`_viberoots()
{
  local cur prev cmd opts
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  cmd="\${COMP_WORDS[1]}"
  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${commandNames}" -- "\${cur}") )
    return 0
  fi
  case "\${cmd}" in
${optionCases}
    *) opts="" ;;
  esac
  COMPREPLY=( $(compgen -W "\${opts}" -- "\${cur}") )
  return 0
}
complete -F _viberoots viberoots
complete -F _viberoots vbr`);
}

function printZshCompletion(): void {
  const commandNames = commandMetadata.map((command) => command.name).join(" ");
  const optionCases = commandMetadata
    .map(
      (command) =>
        `    ${command.name}) _arguments -S ${command.options.map((option) => JSON.stringify(`${option}[${option}]`)).join(" ")} ;;`,
    )
    .join("\n");
  console.log(`#compdef viberoots vbr
_viberoots()
{
  local -a commands
  commands=(${commandNames})
  if (( CURRENT == 2 )); then
    _describe 'viberoots command' commands
    return
  fi
  local cmd="\${words[2]}"
  case "\${cmd}" in
${optionCases}
    *) _files ;;
  esac
}
compdef _viberoots viberoots
compdef _viberoots vbr`);
}

function relativePathRef(fromDir: string, target: string): string {
  const rel = path.relative(fromDir, target) || ".";
  if (rel === ".") return ".";
  return rel.startsWith(".") ? rel : `./${rel}`;
}

function selectedViberootsInputRoot(roots: ReturnType<typeof resolveWorkspaceRootsSync>): string {
  const explicit = (process.env.VIBEROOTS_FLAKE_INPUT_ROOT || "").trim();
  if (explicit) return path.resolve(roots.workspaceRoot, explicit);
  const visibleSubmodule = path.join(roots.workspaceRoot, "viberoots");
  if (fs.existsSync(visibleSubmodule)) return visibleSubmodule;
  const sourceRoot = (process.env.VIBEROOTS_SOURCE_ROOT || "").trim();
  if (sourceRoot) return path.resolve(roots.workspaceRoot, sourceRoot);
  return roots.viberootsRoot;
}

function developPassthroughArgs(): string[] {
  const tokens = getArgvTokens();
  const args = tokens[0] === "develop" ? tokens.slice(1) : tokens;
  const out: string[] = [];
  for (const arg of args) {
    if (arg === "--print" || arg === "--verbose") continue;
    out.push(arg);
  }
  return out;
}

function developCommand(): {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  selectedInputRoot: string;
  workspaceRoot: string;
} {
  const roots = resolveWorkspaceRootsSync();
  const cwd = process.cwd();
  const selectedInputRoot = selectedViberootsInputRoot(roots);
  const workspaceFlake = `${relativePathRef(cwd, roots.viberootsWorkspace)}#default`;
  const viberootsInput = relativePathRef(cwd, selectedInputRoot);
  const toolsBin = path.join(roots.viberootsRoot, "build-tools", "tools", "bin");
  return {
    command: "nix",
    args: [
      "develop",
      "--no-write-lock-file",
      "--accept-flake-config",
      `path:${workspaceFlake}`,
      "--override-input",
      "viberoots",
      `path:${viberootsInput}`,
      ...developPassthroughArgs(),
    ],
    env: {
      ...process.env,
      PATH: `${toolsBin}${path.delimiter}${process.env.PATH || ""}`,
      WORKSPACE_ROOT: roots.workspaceRoot,
      VIBEROOTS_FLAKE_INPUT_ROOT: selectedInputRoot,
    },
    selectedInputRoot,
    workspaceRoot: roots.workspaceRoot,
  };
}

function printShellCommand(command: string, args: string[]): void {
  const quote = (arg: string) =>
    /^[A-Za-z0-9_./:=+#@%,-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`;
  console.log([command, ...args].map(quote).join(" "));
}

async function runDevelop(): Promise<void> {
  const { command, args, env, selectedInputRoot, workspaceRoot } = developCommand();
  if (getFlagBool("print") || getFlagBool("verbose")) {
    printShellCommand(command, args);
    if (getFlagBool("print")) return;
  }
  const oldInputRoot = process.env.VIBEROOTS_FLAKE_INPUT_ROOT;
  process.env.VIBEROOTS_FLAKE_INPUT_ROOT = selectedInputRoot;
  try {
    await repairGeneratedWorkspaceLock({ workspaceRoot });
  } finally {
    if (oldInputRoot === undefined) delete process.env.VIBEROOTS_FLAKE_INPUT_ROOT;
    else process.env.VIBEROOTS_FLAKE_INPUT_ROOT = oldInputRoot;
  }
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }
  process.exit(result.status ?? 1);
}

function usage(): never {
  console.error("error: unknown command");
  console.error("run: viberoots help");
  process.exit(2);
}

function liveBootstrapEnvOverrides(): Record<string, string> {
  const overrides: Record<string, string> = {};
  const mode = getFlagStr("mode");
  const ref = getFlagStr("ref");
  const workspaceRoot = getFlagStr("workspace-root");
  if (mode) overrides.VBR_CONSUMER = mode;
  if (ref) overrides.VBR_REF = ref;
  if (workspaceRoot) overrides.VBR_WORKSPACE_ROOT = path.resolve(workspaceRoot);
  if (getFlagBool("run-install")) overrides.VBR_RUN_INSTALL = "1";
  if (getFlagBool("no-run-install")) overrides.VBR_RUN_INSTALL = "0";
  if (getFlagBool("run-validate")) overrides.VBR_RUN_VALIDATE = "1";
  if (getFlagBool("no-direnv-allow")) overrides.VBR_DIRENV_ALLOW = "0";
  if (getFlagBool("dry-run")) overrides.VBR_DRY_RUN = "1";
  return overrides;
}

async function main() {
  const [command = "version"] = getPositionals();
  if (getFlagBool("help") && commandMeta(command)) {
    printHelp(command);
    return;
  }
  if (command === "help") {
    const [, helpCommand] = getPositionals();
    printHelp(helpCommand);
    return;
  }
  if (command === "completion") {
    const [, shell] = getPositionals();
    if (shell === "bash") {
      printBashCompletion();
      return;
    }
    if (shell === "zsh") {
      printZshCompletion();
      return;
    }
    {
      console.error("error: completion shell must be bash or zsh");
      console.error("run: viberoots completion bash|zsh");
      process.exit(2);
    }
  }
  if (command === "develop") {
    await runDevelop();
    return;
  }
  if (command === "init-workspace") {
    await initWorkspace();
    return;
  }
  if (command === "init-consumer") {
    const mode = getFlagStr("mode", "flake");
    if (mode !== "flake" && mode !== "submodule") {
      console.error("error: init-consumer --mode must be flake or submodule");
      process.exit(2);
    }
    const defaultViberootsUrl = mode === "submodule" ? "path:../../viberoots" : "";
    const viberootsUrl = getFlagStr("viberoots-url", defaultViberootsUrl);
    if (!viberootsUrl) {
      console.error("error: init-consumer requires --viberoots-url <flake-ref>");
      process.exit(2);
    }
    const setupDirenv = getFlagStr("setup-direnv", "auto");
    if (!["auto", "always", "never"].includes(setupDirenv)) {
      console.error("error: init-consumer --setup-direnv must be auto, always, or never");
      process.exit(2);
    }
    await initConsumer({
      workspaceRoot: path.resolve(getFlagStr("workspace-root", process.cwd())),
      viberootsUrl,
      workspaceName: getFlagStr("workspace-name", "viberoots-consumer"),
      sourceMode: mode,
      sourcePath: getFlagStr("source") || (mode === "submodule" ? "viberoots" : undefined),
      lock: !getFlagBool("no-lock"),
      allowDirenv: !getFlagBool("no-direnv"),
      setupDirenv: setupDirenv as "auto" | "always" | "never",
      runInstall: getFlagBool("run-install"),
    });
    return;
  }
  if (command === "bootstrap-check") {
    const result = await checkBootstrapCompletion({
      workspaceRoot: path.resolve(getFlagStr("workspace-root", process.cwd())),
      repair: getFlagBool("repair-if-needed"),
      verbose: getFlagBool("verbose"),
    });
    if (getFlagBool("json")) console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "bootstrap" || command === "update") {
    await runLiveBootstrap({
      command,
      bootstrapUrl: getFlagStr("bootstrap-url", ""),
      trustBootstrapUrl: getFlagBool("trust-bootstrap-url"),
      envOverrides: liveBootstrapEnvOverrides(),
    });
    return;
  }
  if (command === "gc") {
    await runViberootsGc({
      workspaceRoot: path.resolve(getFlagStr("workspace-root", process.cwd())),
      dryRun: getFlagBool("dry-run"),
      aggressive: getFlagBool("aggressive"),
      optimize: getFlagBool("optimize"),
      nix: getFlagBool("nix") || !getFlagBool("no-nix"),
      verbose: getFlagBool("verbose"),
      nixDeleteOlderThan: getFlagStr("nix-delete-older-than", ""),
      keepCurrentProfile: getFlagBool("keep-current-profile"),
    });
    return;
  }
  if (command === "use-submodule") {
    await useSubmodule({
      workspaceRoot: path.resolve(getFlagStr("workspace-root", process.cwd())),
      workspaceName: getFlagStr("workspace-name", ""),
      url: getFlagStr("url", ""),
      trustUrl: getFlagBool("trust-url"),
      allowDirenv: !getFlagBool("no-direnv"),
      runInstall: getFlagBool("run-install"),
    });
    return;
  }
  if (command === "use-flake") {
    await useFlake({
      workspaceRoot: path.resolve(getFlagStr("workspace-root", process.cwd())),
      workspaceName: getFlagStr("workspace-name", ""),
      ref: getFlagStr("ref", ""),
      removeSubmodule: getFlagBool("remove-submodule"),
      allowDirenv: !getFlagBool("no-direnv"),
      runInstall: getFlagBool("run-install"),
    });
    return;
  }
  if (command === "remove-submodule") {
    await removeSubmodule({
      workspaceRoot: path.resolve(getFlagStr("workspace-root", process.cwd())),
      dryRun: getFlagBool("dry-run"),
    });
    return;
  }
  if (command !== "version" && command !== "status") usage();
  const status = buildVersionStatus();
  if (getFlagBool("json")) console.log(JSON.stringify(status, null, 2));
  else printText(status);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});

import { getArgvTokens, readFlagBoolFromTokens, readFlagStrFromTokens } from "../lib/argv";
import {
  DEFAULT_BOOTSTRAP_ARGS,
  resolveInfisicalHost,
  withDeploymentBootstrapDefaults,
} from "./infisical-iac-bootstrap-config";
import type { BootstrapArgs } from "./infisical-iac-bootstrap-types";

const VALUE_FLAGS = new Set([
  "infisical-host",
  "api-url",
  "cli-domain",
  "organization-id",
  "org-name",
  "identity-name",
  "org-role",
  "access-token-env",
  "infisical-bin",
  "login-mode",
  "tofu-dir",
  "tofu-plan-file",
  "credential-sink",
  "local-credential-file",
  "sprinkle-category",
  "secret-backend",
  "bootstrap-scope",
  "infisical-project-name",
  "bootstrap-keychain-service-name",
  "keychain-service-name",
  "machine-label",
  "client-secret-ttl",
  "access-token-ttl",
  "target",
]);
const BOOL_FLAGS = new Set([
  "help",
  "no-login",
  "force-login",
  "yes",
  "dry-run",
  "without-deployments",
  "apply-metadata-patch",
  "no-tofu-apply",
  "rotate-bootstrap-credentials",
  "rotate-deployment-credentials",
  "force-overwrite-local-credentials",
  "select-infisical-project",
]);

export function usage(command = "build-tools/tools/deployments/infisical-bootstrap.ts") {
  return `Usage:
  ${command} repo --dry-run
  ${command} repo
  ${command} repo --yes
  ${command} repo --without-deployments
  ${command} deployment --target <buck-target> --dry-run
  ${command} deployment --target <buck-target>
  ${command} deployment --target <buck-target> --yes

Options:
  --infisical-host <us|eu|url>  Infisical host shorthand or URL
  --api-url <url>               Infisical API base URL
  --cli-domain <url>            Infisical CLI API URL
  --organization-id <id>        Infisical organization ID
  --org-name <name>             Exact organization name to select
  --no-login                    Require an access token from --access-token-env
  --access-token-env <name>     Human/admin token env var
  --login-mode <browser|interactive>
                                  Use browser login or Infisical CLI command-line login
  --tofu-plan-file <path>       Saved OpenTofu plan path
  --no-tofu-apply               Stop after saved plan
  --rotate-bootstrap-credentials
  --rotate-deployment-credentials
  --machine-label <label>       Label created Universal Auth client secrets for this machine
  --bootstrap-scope <name>      First secret:// path segment for repo bootstrap credentials
  --infisical-project-name <name>
                                  Infisical repo project name; defaults to the consumer repo name
  --select-infisical-project       Reopen the project chooser for generated Infisical repo profiles
  --bootstrap-keychain-service-name <name>
                                  macOS Keychain service for bootstrap credentials
  --keychain-service-name <name>  macOS Keychain service for repo main secrets
  --credential-sink <auto|local-file|macos-keychain|sprinkleref>
  --secret-backend <backend/profile>
                               Select the repo default secret backend, e.g. vault/default or keychain/default
  --yes                         Skip confirmation prompts
  --dry-run                     Print non-secret planned operations
  --without-deployments          Skip repo bootstrap deployment fan-out
  --apply-metadata-patch         Apply reviewed first-bootstrap metadata patch non-interactively
`;
}

export function parseBootstrapArgs(argv = getArgvTokens()): BootstrapArgs {
  validateKnownFlags(argv);
  const args: BootstrapArgs = { ...DEFAULT_BOOTSTRAP_ARGS };
  const mode = modeFromArgs(argv);
  if (!mode) throw new Error("use exactly one bootstrap mode: repo or deployment");
  args.mode = mode;
  setString(args, "target", readFlagStrFromTokens("target", "", argv));
  const host = readFlagStrFromTokens("infisical-host", "", argv).trim();
  if (host) {
    Object.assign(args, resolveInfisicalHost(host));
    args.hostOverride = true;
  }
  const apiUrl = readFlagStrFromTokens("api-url", "", argv);
  const cliDomain = readFlagStrFromTokens("cli-domain", "", argv);
  if (setString(args, "apiUrl", apiUrl)) args.hostOverride = true;
  if (setString(args, "cliDomain", cliDomain)) args.hostOverride = true;
  setString(args, "organizationId", readFlagStrFromTokens("organization-id", "", argv));
  setString(args, "orgName", readFlagStrFromTokens("org-name", "", argv));
  setString(args, "identityName", readFlagStrFromTokens("identity-name", "", argv));
  setString(args, "accessTokenEnv", readFlagStrFromTokens("access-token-env", "", argv));
  setString(args, "infisicalBin", readFlagStrFromTokens("infisical-bin", "", argv));
  args.loginMode = enumFlag("login-mode", args.loginMode, ["browser", "interactive"], argv);
  setString(args, "tofuDir", readFlagStrFromTokens("tofu-dir", "", argv));
  setString(args, "tofuPlanFile", readFlagStrFromTokens("tofu-plan-file", "", argv));
  setString(args, "localCredentialFile", readFlagStrFromTokens("local-credential-file", "", argv));
  setString(args, "sprinkleCategory", readFlagStrFromTokens("sprinkle-category", "", argv));
  setString(args, "secretBackend", readFlagStrFromTokens("secret-backend", "", argv));
  setString(args, "bootstrapCredentialScope", readFlagStrFromTokens("bootstrap-scope", "", argv));
  setString(
    args,
    "infisicalProjectName",
    readFlagStrFromTokens("infisical-project-name", "", argv),
  );
  setString(
    args,
    "bootstrapKeychainServiceName",
    readFlagStrFromTokens("bootstrap-keychain-service-name", "", argv),
  );
  setString(args, "keychainServiceName", readFlagStrFromTokens("keychain-service-name", "", argv));
  setString(args, "machineLabel", readFlagStrFromTokens("machine-label", "", argv));
  args.orgRole = enumFlag("org-role", args.orgRole, ["no-access", "member", "admin"], argv);
  args.credentialSink = enumFlag(
    "credential-sink",
    args.credentialSink,
    ["auto", "local-file", "macos-keychain", "sprinkleref"],
    argv,
  );
  args.noLogin = readFlagBoolFromTokens("no-login", argv);
  args.forceLogin = readFlagBoolFromTokens("force-login", argv);
  args.yes = readFlagBoolFromTokens("yes", argv);
  args.dryRun = readFlagBoolFromTokens("dry-run", argv);
  args.withoutDeployments = readFlagBoolFromTokens("without-deployments", argv);
  args.applyMetadataPatch = readFlagBoolFromTokens("apply-metadata-patch", argv);
  args.noTofuApply = readFlagBoolFromTokens("no-tofu-apply", argv);
  args.rotateBootstrapCredentials = readFlagBoolFromTokens("rotate-bootstrap-credentials", argv);
  args.rotateDeploymentCredentials = readFlagBoolFromTokens("rotate-deployment-credentials", argv);
  args.forceOverwriteLocalCredentials = readFlagBoolFromTokens(
    "force-overwrite-local-credentials",
    argv,
  );
  args.selectInfisicalProject = readFlagBoolFromTokens("select-infisical-project", argv);
  args.clientSecretTtl = numberFlag("client-secret-ttl", args.clientSecretTtl, 0, argv);
  args.accessTokenTtl = numberFlag("access-token-ttl", args.accessTokenTtl, 1, argv);
  if (args.organizationId && args.orgName)
    throw new Error("use only one of --organization-id or --org-name");
  if (args.noLogin && !args.organizationId && !args.orgName) {
    throw new Error(
      "--no-login requires exactly one organization selector: pass --org-name <name> or --organization-id <id>",
    );
  }
  if (args.noLogin && args.forceLogin)
    throw new Error("use only one of --no-login or --force-login");
  validateMachineLabel(args.machineLabel);
  if (args.mode === "deployment" && !args.target) {
    throw new Error("infisical bootstrap deployment mode requires --target <buck-target>");
  }
  return withDeploymentBootstrapDefaults(args);
}

function validateMachineLabel(label: string | undefined) {
  if (!label) return;
  if (label.length > 80 || /[\r\n\t]/.test(label)) {
    throw new Error("--machine-label must be 1-80 characters without control whitespace");
  }
}

function modeFromArgs(argv: string[]): BootstrapArgs["mode"] | undefined {
  const modes = argv.filter((token) => token === "repo" || token === "deployment");
  if (modes.length > 1) throw new Error("use exactly one bootstrap mode: repo or deployment");
  return modes[0] as BootstrapArgs["mode"] | undefined;
}

function setString<T extends keyof BootstrapArgs>(args: BootstrapArgs, key: T, value: string) {
  if (!value.trim()) return false;
  (args[key] as string | undefined) = value.trim();
  return true;
}

function enumFlag<T extends string>(name: string, def: T, allowed: readonly T[], argv: string[]) {
  const value = readFlagStrFromTokens(name, "", argv).trim();
  if (!value) return def;
  if (!allowed.includes(value as T))
    throw new Error(`--${name} must be one of: ${allowed.join(", ")}`);
  return value as T;
}

function numberFlag(name: string, def: number, min: number, argv: string[]) {
  const value = readFlagStrFromTokens(name, "", argv).trim();
  if (!value) return def;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) throw new Error(`--${name} must be >= ${min}`);
  return parsed;
}

function validateKnownFlags(argv: string[]) {
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const name = token.slice(2).split("=")[0];
    if (!VALUE_FLAGS.has(name) && !BOOL_FLAGS.has(name))
      throw new Error(`unknown argument: --${name}`);
  }
}

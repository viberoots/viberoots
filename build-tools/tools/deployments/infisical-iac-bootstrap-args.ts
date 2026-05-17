import { getArgvTokens, readFlagBoolFromTokens, readFlagStrFromTokens } from "../lib/argv";
import { DEFAULT_BOOTSTRAP_ARGS, resolveInfisicalHost } from "./infisical-iac-bootstrap-config";
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
  "tofu-dir",
  "tofu-plan-file",
  "credential-sink",
  "local-credential-file",
  "sprinkle-category",
  "client-secret-ttl",
  "access-token-ttl",
]);
const BOOL_FLAGS = new Set([
  "help",
  "no-login",
  "force-login",
  "yes",
  "dry-run",
  "no-tofu-apply",
  "rotate-bootstrap-credentials",
  "force-overwrite-local-credentials",
]);

export function usage() {
  return `Usage:
  infisical-iac-bootstrap.ts [--organization-id <id> | --org-name <name>] [options]

Options:
  --infisical-host <us|eu|url>  Infisical host shorthand or URL
  --api-url <url>               Infisical API base URL
  --cli-domain <url>            Infisical CLI API URL
  --organization-id <id>        Infisical organization ID
  --org-name <name>             Exact organization name to select
  --no-login                    Require an access token from --access-token-env
  --access-token-env <name>     Human/admin token env var
  --tofu-plan-file <path>       Saved OpenTofu plan path
  --no-tofu-apply               Stop after saved plan
  --rotate-bootstrap-credentials
  --credential-sink <auto|local-file|macos-keychain|sprinkleref>
  --yes                         Skip deterministic prompts and apply confirmation
  --dry-run                     Print non-secret planned operations
`;
}

export function parseBootstrapArgs(argv = getArgvTokens()): BootstrapArgs {
  validateKnownFlags(argv);
  const args: BootstrapArgs = { ...DEFAULT_BOOTSTRAP_ARGS };
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
  setString(args, "tofuDir", readFlagStrFromTokens("tofu-dir", "", argv));
  setString(args, "tofuPlanFile", readFlagStrFromTokens("tofu-plan-file", "", argv));
  setString(args, "localCredentialFile", readFlagStrFromTokens("local-credential-file", "", argv));
  setString(args, "sprinkleCategory", readFlagStrFromTokens("sprinkle-category", "", argv));
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
  args.noTofuApply = readFlagBoolFromTokens("no-tofu-apply", argv);
  args.rotateBootstrapCredentials = readFlagBoolFromTokens("rotate-bootstrap-credentials", argv);
  args.forceOverwriteLocalCredentials = readFlagBoolFromTokens(
    "force-overwrite-local-credentials",
    argv,
  );
  args.clientSecretTtl = numberFlag("client-secret-ttl", args.clientSecretTtl, 0, argv);
  args.accessTokenTtl = numberFlag("access-token-ttl", args.accessTokenTtl, 1, argv);
  if (args.organizationId && args.orgName)
    throw new Error("use only one of --organization-id or --org-name");
  if (args.noLogin && args.forceLogin)
    throw new Error("use only one of --no-login or --force-login");
  return args;
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

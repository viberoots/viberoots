import { getArgvTokens } from "../../lib/argv";
import { parseAccountArgs } from "./arguments";
import { fail } from "./errors";
import { listAccounts } from "./list";
import { applyLoginLifecycle } from "./login";
import { removeAccount } from "./removal";
import { resolveAccount } from "./resolution";
import { writeWrapperPlan } from "./transport";
import type { WrapperPlan } from "./types";
import { checkUpstreamVersion } from "./version";

const HELP = `Wrapper-owned flags (this repository's codex wrapper):
  --account <name>       Select an OpenAI account (rebinds CODEX_HOME).
  --account-init         Create an unauthenticated account and run codex login.
  --list-accounts        List configured accounts.
  --list-accounts=json   List configured accounts as JSON.
  --remove-account <n>   Remove a non-default, unlocked account.
    --yes                Confirm account removal.

Env: CODEX_ACCOUNT, CODEX_ACCOUNT_INIT, CODEX_ACCOUNT_REMOVE_YES,
     VBR_CODEX_NONINTERACTIVE.
Precedence: --account > CODEX_HOME > CODEX_ACCOUNT > default symlink > ~/.codex/.
See: docs/history/designs/codex-wrapper-accounts-design.md

`;

function prepareArgs(): string[] {
  const tokens = getArgvTokens();
  const marker = tokens.indexOf("--");
  if (tokens[0] !== "prepare" || marker < 0) fail("error: prepare requires '--' before argv", 2);
  return tokens.slice(marker + 1);
}

function managementOnly(args: string[]): boolean {
  return args.some(
    (arg) =>
      arg === "--list-worktrees" ||
      arg === "--remove-all-worktrees" ||
      arg === "--remove-worktree" ||
      arg.startsWith("--remove-worktree="),
  );
}

function topLevelIntrospection(command: string | null, args: string[]): boolean {
  return (
    command === "help" ||
    command === "version" ||
    args[0] === "--help" ||
    args[0] === "-h" ||
    args[0] === "--version" ||
    args[0] === "-V"
  );
}

function noAccountDiagnostic(): void {
  process.stderr.write(
    "error: no codex account resolved\n" +
      "  tried: --account, CODEX_HOME, CODEX_ACCOUNT, ~/.codex-accounts/default, ~/.codex/\n" +
      "  run: codex --account <name> login\n" +
      "  or:  export CODEX_HOME=/absolute/path\n",
  );
}

export async function runPrepare(): Promise<number> {
  const root = process.env.VBR_CODEX_ACCOUNTS_ROOT || "";
  const legacyRoot = process.env.VBR_CODEX_LEGACY_ROOT || "";
  const realCodex = process.env.VBR_CODEX_REAL_BINARY || "";
  const transport = process.env.VBR_CODEX_ACCOUNT_PLAN || "";
  if (!root || !legacyRoot || !transport) fail("error: missing wrapper/helper account context", 2);

  const originalArgs = prepareArgs();
  const parsed = parseAccountArgs(originalArgs);
  if (topLevelIntrospection(parsed.command, parsed.strippedArgs)) process.stdout.write(HELP);

  let plan: WrapperPlan;
  if (parsed.removeName) {
    plan = await removeAccount(root, parsed.removeName, parsed.removeYes);
  } else {
    const resolution = await resolveAccount(parsed, root, legacyRoot);
    for (const warning of resolution.warnings) process.stderr.write(`${warning}\n`);
    if (parsed.listFormat) {
      const code = await listAccounts(
        root,
        legacyRoot,
        resolution.codexHome || "",
        parsed.listFormat,
      );
      plan = { action: "exit", exitCode: code === 3 ? 65 : code };
    } else {
      const lifecycle = await applyLoginLifecycle({
        parsed,
        resolution,
        root,
        realCodex,
        originalArgs,
      });
      if (lifecycle) {
        plan = lifecycle;
      } else if (
        !resolution.codexHome &&
        !topLevelIntrospection(parsed.command, parsed.strippedArgs) &&
        !managementOnly(parsed.strippedArgs)
      ) {
        noAccountDiagnostic();
        plan = { action: "exit", exitCode: 65 };
      } else {
        if (!managementOnly(parsed.strippedArgs)) await checkUpstreamVersion(realCodex);
        plan = {
          action: "delegate",
          codexHome: resolution.codexHome,
          args: parsed.strippedArgs,
          reexecPrefix: parsed.reexecPrefix,
        };
      }
    }
  }
  await writeWrapperPlan(transport, plan);
  return 0;
}

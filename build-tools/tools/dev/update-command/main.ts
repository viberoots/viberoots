import process from "node:process";
import { getArgvTokens } from "../../lib/argv";
import { findRepoRoot } from "../../lib/repo";
import { parseUpdateCommandArgs, UPDATE_COMMAND_HELP } from "./args";
import { runUpdateCommand } from "./run";

async function main(): Promise<void> {
  const args = parseUpdateCommandArgs(getArgvTokens());
  if (args === "help") {
    console.log(UPDATE_COMMAND_HELP);
    return;
  }
  const root = await findRepoRoot(process.cwd());
  process.env.WORKSPACE_ROOT = root;
  process.env.BUCK_TEST_SRC = root;
  await runUpdateCommand({ root, ...args });
  console.log(
    args.upgrade
      ? "project dependencies upgraded and reconciled"
      : "project dependencies reconciled",
  );
  console.log("next: i && b && v");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

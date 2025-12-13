import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";

export async function confirmOrExit(summary: string, yes: boolean, dry: boolean) {
  console.log(summary);
  if (dry) {
    console.log("[dry-run] no changes made");
    process.exit(0);
  }
  if (yes) return;
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input, output });
    const answer = (await rl.question("Proceed? [y/N] ")).trim().toLowerCase();
    rl.close();
    if (answer !== "y" && answer !== "yes") {
      console.error("Aborted. Use --yes to confirm.");
      process.exit(2);
    }
    return;
  }
  console.error("Aborted. Use --yes to confirm.");
  process.exit(2);
}

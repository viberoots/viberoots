import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { buckconfig } from "../../lib/consumer-bootstrap";
import { envrc } from "../../lib/consumer-direnv";
import { consumerGitignoreEntries } from "../../lib/consumer-tracked-inputs";

export const execFileAsync = promisify(execFile);
export const commitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};

export async function ccFixture(mode: "flake" | "submodule"): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `vbr-cc-${mode}-`));
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await fsp.writeFile(
    path.join(root, "flake.nix"),
    mode === "submodule"
      ? 'inputs.viberoots.url = "path:./viberoots";\n'
      : 'inputs.viberoots.url = "github:viberoots/viberoots/pinned";\n',
  );
  await fsp.writeFile(path.join(root, ".buckconfig"), buckconfig(mode));
  await fsp.writeFile(path.join(root, ".buckroot"), ".\n");
  await fsp.writeFile(path.join(root, ".envrc"), envrc());
  await fsp.writeFile(
    path.join(root, ".gitignore"),
    `# viberoots local workspace state\n${consumerGitignoreEntries.join("\n")}\n`,
  );
  await execFileAsync(
    "git",
    ["add", "flake.nix", ".buckconfig", ".buckroot", ".envrc", ".gitignore"],
    { cwd: root },
  );
  await execFileAsync("git", ["commit", "-qm", "fixture"], { cwd: root, env: commitEnv });
  return root;
}

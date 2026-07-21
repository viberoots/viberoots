import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { buckconfig } from "../../lib/consumer-bootstrap";
import { envrc } from "../../lib/consumer-direnv";
import { consumerGitignoreEntries } from "../../lib/consumer-tracked-inputs";
import { renderGlobalNixInputTargets } from "../../lib/global-nix-input-targets";

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
  await fsp.mkdir(path.join(root, "projects", "config"), { recursive: true });
  const targets = renderGlobalNixInputTargets({
    hashesJson: Buffer.from("{}\n"),
    flakeNix: Buffer.from(""),
    flakeLock: Buffer.from(""),
    registryExtension: Buffer.from(""),
  });
  await fsp.writeFile(
    path.join(root, "projects", "config", "TARGETS"),
    targets.projectsConfigTargets,
  );
  await fsp.writeFile(path.join(root, "projects", "config", "node-modules.hashes.json"), "{}\n");
  await execFileAsync(
    "git",
    [
      "add",
      "flake.nix",
      ".buckconfig",
      ".buckroot",
      ".envrc",
      ".gitignore",
      "projects/config/TARGETS",
      "projects/config/node-modules.hashes.json",
    ],
    { cwd: root },
  );
  await execFileAsync("git", ["commit", "-qm", "fixture"], { cwd: root, env: commitEnv });
  return root;
}

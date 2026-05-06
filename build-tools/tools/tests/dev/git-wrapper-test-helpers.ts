import * as fsp from "node:fs/promises";
import path from "node:path";

export const repoRoot = process.cwd();
export const wrapper = path.join(repoRoot, "build-tools", "tools", "bin", "git");
export const scratchRoot = path.join(repoRoot, "buck-out", "tmp");

export async function writeExecutable(file: string, text: string): Promise<void> {
  await fsp.writeFile(file, text, "utf8");
  await fsp.chmod(file, 0o755);
}

export async function realGit(): Promise<string> {
  const filteredPath = String(process.env.PATH || "")
    .split(path.delimiter)
    .filter((entry) => path.resolve(entry || ".") !== path.dirname(wrapper))
    .join(path.delimiter);
  const out = await $({
    stdio: "pipe",
    env: { ...process.env, PATH: filteredPath },
  })`bash --noprofile --norc -c 'type -a -p git'`;
  const candidates = String(out.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return candidates.find((candidate) => candidate.startsWith("/nix/store/")) || candidates[0] || "";
}

export async function initRepo(root: string, gitPath: string): Promise<void> {
  await $({ cwd: root, stdio: "pipe" })`${gitPath} init -q`;
  await $({ cwd: root, stdio: "pipe" })`${gitPath} config user.email test@example.com`;
  await $({ cwd: root, stdio: "pipe" })`${gitPath} config user.name Test`;
  await fsp.writeFile(path.join(root, "tracked.txt"), "tracked\n", "utf8");
  await fsp.mkdir(path.join(root, "dir"));
  await fsp.writeFile(path.join(root, "dir", ".hidden"), "hidden\n", "utf8");
  await $({ cwd: root, stdio: "pipe" })`${gitPath} add tracked.txt dir/.hidden`;
  await $({ cwd: root, stdio: "pipe" })`${gitPath} commit -qm initial`;
}

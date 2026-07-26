import * as fsp from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  throw new Error(`Cargo path dependency must use a quoted path: ${value}`);
}

function dependencySection(section: string): boolean {
  return /(^|\.)(dependencies|build-dependencies|dev-dependencies)$/.test(section);
}

function tableDependencySection(section: string): boolean {
  return /(^|\.)(dependencies|build-dependencies|dev-dependencies)\.[^.]+$/.test(section);
}

function stripComment(line: string): string {
  let quote = "";
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if ((char === '"' || char === "'") && line[index - 1] !== "\\") {
      quote = quote === char ? "" : quote || char;
    }
    if (char === "#" && !quote) return line.slice(0, index);
  }
  return line;
}

function inlinePath(statement: string): string | undefined {
  const assignment = statement.match(/^[^=]+=\s*\{([\s\S]*)\}\s*$/);
  if (!assignment) return undefined;
  const pathField = assignment[1].match(/(?:^|,)\s*path\s*=\s*("[^"]*"|'[^']*')/);
  return pathField ? unquote(pathField[1]) : undefined;
}

export function cargoManifestPathDependencies(source: string): string[] {
  const paths: string[] = [];
  let section = "";
  let statement = "";
  let braces = 0;
  for (const raw of source.split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (!line) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header && braces === 0) {
      section = header[1].trim();
      continue;
    }
    if (tableDependencySection(section)) {
      const field = line.match(/^path\s*=\s*(.+)$/);
      if (field) paths.push(unquote(field[1]));
      continue;
    }
    if (!dependencySection(section)) continue;
    statement = statement ? `${statement}\n${line}` : line;
    braces += [...line].filter((char) => char === "{").length;
    braces -= [...line].filter((char) => char === "}").length;
    if (braces > 0) continue;
    const dependencyPath = inlinePath(statement);
    if (dependencyPath) paths.push(dependencyPath);
    statement = "";
    braces = 0;
  }
  if (braces !== 0) throw new Error("Cargo manifest has an unterminated dependency table");
  return [...new Set(paths)].sort();
}

type CargoWorkspace = { members: string[]; exclude: string[] };

function quotedArray(value: string, field: string): string[] {
  const open = value.indexOf("[");
  const close = value.lastIndexOf("]");
  if (open < 0 || close < open) throw new Error(`Cargo workspace.${field} must use an array`);
  const body = value.slice(open + 1, close);
  const values: string[] = [];
  let rest = body;
  while (rest.trim()) {
    const match = rest.match(/^\s*(["'])(.*?)\1\s*(?:,|$)/s);
    if (!match) throw new Error(`Cargo workspace.${field} must contain quoted paths`);
    values.push(match[2]);
    rest = rest.slice(match[0].length);
  }
  return values;
}

export function cargoManifestWorkspace(source: string): CargoWorkspace {
  const result: CargoWorkspace = { members: [], exclude: [] };
  let section = "";
  let field: keyof CargoWorkspace | "" = "";
  let statement = "";
  let brackets = 0;
  for (const raw of source.split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (!line) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header && brackets === 0) {
      section = header[1].trim();
      continue;
    }
    if (section !== "workspace") continue;
    if (!field) {
      const assignment = line.match(/^(members|exclude)\s*=\s*(.*)$/);
      if (!assignment) continue;
      field = assignment[1] as keyof CargoWorkspace;
      statement = assignment[2];
    } else {
      statement += `\n${line}`;
    }
    brackets += [...line].filter((char) => char === "[").length;
    brackets -= [...line].filter((char) => char === "]").length;
    if (brackets > 0) continue;
    if (brackets < 0) throw new Error(`Cargo workspace.${field} has an unmatched bracket`);
    result[field].push(...quotedArray(statement, field));
    field = "";
    statement = "";
  }
  if (field || brackets !== 0) throw new Error("Cargo workspace has an unterminated member array");
  return {
    members: [...new Set(result.members)].sort(),
    exclude: [...new Set(result.exclude)].sort(),
  };
}

async function workspaceMemberRoots(root: string, workspace: CargoWorkspace): Promise<string[]> {
  if (workspace.members.length === 0) return [];
  const members = await fg(workspace.members, {
    cwd: root,
    onlyDirectories: true,
    unique: true,
    dot: true,
    followSymbolicLinks: false,
    ignore: workspace.exclude,
  });
  return members.map((member) => path.resolve(root, member)).sort();
}

export async function reachableCargoRoots(
  source: string,
  workspaceRoot: string,
): Promise<string[]> {
  const workspace = path.resolve(workspaceRoot);
  const realWorkspace = await fsp.realpath(workspace);
  const pending = [path.resolve(source)];
  const roots = new Set<string>();
  while (pending.length > 0) {
    const root = pending.shift()!;
    if (roots.has(root)) continue;
    if (root !== workspace && !root.startsWith(`${workspace}${path.sep}`)) {
      throw new Error(`Cargo path dependency escapes the workspace: ${root}`);
    }
    const realRoot = await fsp.realpath(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        throw new Error(`Cargo path dependency root is missing: ${root}`);
      }
      throw error;
    });
    const expectedRoot = path.resolve(realWorkspace, path.relative(workspace, root));
    if (realRoot !== expectedRoot) {
      throw new Error(`Cargo path dependency root traverses a symlink: ${root} -> ${realRoot}`);
    }
    const manifest = path.join(root, "Cargo.toml");
    const contents = await fsp.readFile(manifest, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        throw new Error(`Cargo path dependency is missing Cargo.toml: ${manifest}`);
      }
      throw error;
    });
    roots.add(root);
    const cargoWorkspace = cargoManifestWorkspace(contents);
    for (const member of await workspaceMemberRoots(root, cargoWorkspace)) pending.push(member);
    for (const relative of cargoManifestPathDependencies(contents)) {
      const dependency = path.resolve(root, relative);
      if (dependency !== workspace && !dependency.startsWith(`${workspace}${path.sep}`)) {
        throw new Error(`Cargo path dependency escapes the workspace: ${manifest} -> ${relative}`);
      }
      pending.push(dependency);
    }
  }
  return [...roots].sort();
}

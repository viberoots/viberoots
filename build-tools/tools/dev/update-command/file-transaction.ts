import * as fsp from "node:fs/promises";
import path from "node:path";

type FileSnapshot = {
  file: string;
  kind: "absent" | "directory" | "file" | "symlink";
  bytes?: Buffer;
  children?: FileSnapshot[];
  mode?: number;
  target?: string;
};

async function snapshotFile(file: string): Promise<FileSnapshot> {
  try {
    const stat = await fsp.lstat(file);
    if (stat.isSymbolicLink()) {
      return { file, kind: "symlink", target: await fsp.readlink(file) };
    }
    if (stat.isDirectory()) {
      const names = await fsp.readdir(file);
      return {
        file,
        kind: "directory",
        children: await Promise.all(
          names.sort().map((name) => snapshotFile(path.join(file, name))),
        ),
        mode: stat.mode,
      };
    }
    if (!stat.isFile())
      throw new Error(`update transaction path is not a file or symlink: ${file}`);
    return { file, kind: "file", bytes: await fsp.readFile(file), mode: stat.mode };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { file, kind: "absent" };
    throw error;
  }
}

async function restoreFile(snapshot: FileSnapshot): Promise<void> {
  if (snapshot.kind === "absent") {
    await fsp.rm(snapshot.file, { recursive: true, force: true });
    return;
  }
  await fsp.mkdir(path.dirname(snapshot.file), { recursive: true });
  await fsp.rm(snapshot.file, { recursive: true, force: true });
  if (snapshot.kind === "directory") {
    await fsp.mkdir(snapshot.file, { mode: snapshot.mode, recursive: true });
    for (const child of snapshot.children as FileSnapshot[]) await restoreFile(child);
    await fsp.chmod(snapshot.file, snapshot.mode as number);
    return;
  }
  if (snapshot.kind === "symlink") {
    await fsp.symlink(snapshot.target as string, snapshot.file);
    return;
  }
  await fsp.writeFile(snapshot.file, snapshot.bytes as Buffer, { mode: snapshot.mode });
  await fsp.chmod(snapshot.file, snapshot.mode as number);
}

export async function withFileRollback<T>(
  files: string[],
  operation: () => Promise<T>,
): Promise<T> {
  const snapshots = await Promise.all(files.map(snapshotFile));
  try {
    return await operation();
  } catch (error) {
    for (const snapshot of snapshots) await restoreFile(snapshot);
    throw error;
  }
}

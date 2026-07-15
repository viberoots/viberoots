import * as fsp from "node:fs/promises";
import path from "node:path";

type FileSnapshot = {
  file: string;
  existed: boolean;
  bytes?: Buffer;
};

async function snapshotFile(file: string): Promise<FileSnapshot> {
  try {
    return { file, existed: true, bytes: await fsp.readFile(file) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { file, existed: false };
    throw error;
  }
}

async function restoreFile(snapshot: FileSnapshot): Promise<void> {
  if (!snapshot.existed) {
    await fsp.rm(snapshot.file, { force: true });
    return;
  }
  await fsp.mkdir(path.dirname(snapshot.file), { recursive: true });
  await fsp.writeFile(snapshot.file, snapshot.bytes as Buffer);
}

export async function withFileRollback<T>(
  files: string[],
  operation: () => Promise<T>,
): Promise<T> {
  const snapshots = await Promise.all(files.map(snapshotFile));
  try {
    return await operation();
  } catch (error) {
    await Promise.all(snapshots.map(restoreFile));
    throw error;
  }
}

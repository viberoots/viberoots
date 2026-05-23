import path from "node:path";

export function uniqueRegisteredRoots(roots: string[]): string[] {
  return Array.from(
    new Set(
      roots.flatMap((root) => {
        const trimmed = root.trim();
        return trimmed ? [path.resolve(trimmed)] : [];
      }),
    ),
  ).filter((root) => root.length > 1);
}

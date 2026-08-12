import crypto from "node:crypto";

export function protectedStorePath(value: string): boolean {
  return /^\/nix\/store\/[a-z0-9]{32}-[^/]+(?:\/.*)?$/u.test(value);
}

export function protectedDigestShape(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/u.test(value);
}

export function protectedEvidenceDigest(value: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function assertProtectedEvidenceKeys(value: object, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`protected Rust patch evidence has invalid fields: ${actual.join(", ")}`);
  }
}

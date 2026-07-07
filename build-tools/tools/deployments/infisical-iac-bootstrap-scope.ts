export function normalizeBootstrapScope(scope: string): string {
  const trimmed = scope.trim();
  if (!trimmed) throw new Error("Infisical bootstrap scope must not be empty");
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error(
      `Infisical bootstrap scope ${JSON.stringify(scope)} must contain only letters, numbers, dot, underscore, or dash`,
    );
  }
  return trimmed;
}

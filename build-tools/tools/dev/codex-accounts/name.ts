export const ACCOUNT_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

const RESERVED_NAMES = new Set(["default", "legacy", ".codex", ".", ".."]);

export function isValidAccountName(name: string): boolean {
  return ACCOUNT_NAME_PATTERN.test(name) && !name.startsWith("-") && !RESERVED_NAMES.has(name);
}

export function accountNameError(name: string): string {
  return `error: invalid account name '${name}'; must match ^[A-Za-z0-9._-]{1,64}$, must not start with '-', and must not be 'default' or 'legacy'`;
}

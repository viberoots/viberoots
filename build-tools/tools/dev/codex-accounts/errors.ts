export class AccountCommandError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.name = "AccountCommandError";
    this.exitCode = exitCode;
  }
}

export function fail(message: string, exitCode: number): never {
  throw new AccountCommandError(message, exitCode);
}

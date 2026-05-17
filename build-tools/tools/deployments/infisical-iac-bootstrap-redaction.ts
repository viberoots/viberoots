export function redactText(text: string, secrets: Array<string | undefined>) {
  const redacted = secrets
    .filter((secret): secret is string => Boolean(secret && secret.length >= 4))
    .reduce((current, secret) => current.split(secret).join("[REDACTED]"), text);
  return redactSensitiveAssignments(redacted);
}

export function errorMessage(error: unknown, secrets: Array<string | undefined> = []) {
  const raw = error instanceof Error ? error.message : String(error);
  return redactText(raw, secrets);
}

function redactSensitiveAssignments(text: string) {
  const keys =
    "access[_-]?token|personal[_-]?token|client[_-]?secret|secret[_-]?value|token|secret";
  return text
    .replace(new RegExp(`"(${keys})"\\s*:\\s*"[^"]*"`, "gi"), '"$1":"[REDACTED]"')
    .replace(
      new RegExp(`\\b(${keys})\\s*([=:])\\s*("[^"]*"|'[^']*'|\\S+)`, "gi"),
      "$1$2 [REDACTED]",
    );
}

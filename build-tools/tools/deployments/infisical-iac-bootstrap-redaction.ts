export function redactText(text: string, secrets: Array<string | undefined>) {
  return secrets
    .filter((secret): secret is string => Boolean(secret && secret.length >= 4))
    .reduce((current, secret) => current.split(secret).join("[REDACTED]"), text);
}

export function errorMessage(error: unknown, secrets: Array<string | undefined> = []) {
  const raw = error instanceof Error ? error.message : String(error);
  return redactText(raw, secrets);
}

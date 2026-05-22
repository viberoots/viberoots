import { redactText } from "./infisical-iac-bootstrap-redaction";

export class InfisicalApi {
  private readonly apiUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { apiUrl: string; token: string; fetchImpl?: typeof fetch }) {
    this.apiUrl = opts.apiUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    allow404 = false,
  ): Promise<T | undefined> {
    const response = await this.fetchImpl(`${this.apiUrl}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (allow404 && response.status === 404) return undefined;
    if (response.status >= 400) {
      const redacted = redactInfisicalApiBody(text, [this.token]);
      throw new Error(
        `Infisical API ${method} ${endpoint} failed with HTTP ${response.status}: ${redacted}`,
      );
    }
    return (text ? JSON.parse(text) : undefined) as T | undefined;
  }
}

export function redactInfisicalApiBody(text: string, secrets: string[] = []) {
  const keyPattern =
    /("(?:accessToken|access_token|token|clientSecret|client_secret|secretValue|secret_value|value)"\s*:\s*")([^"]+)(")/gi;
  return redactText(text.replace(keyPattern, "$1[REDACTED]$3"), secrets);
}

export async function listClientSecrets(api: InfisicalApi, identityId: string) {
  const result = await api.request<{ clientSecretData?: unknown[]; clientSecrets?: unknown[] }>(
    "GET",
    `/api/v1/auth/universal-auth/identities/${encodeURIComponent(identityId)}/client-secrets`,
    undefined,
    true,
  );
  return result?.clientSecrets ?? result?.clientSecretData ?? [];
}

export function summarizeClientSecretRecords(records: unknown[]) {
  return records.flatMap((record) => {
    if (!record || typeof record !== "object") return [];
    const item = record as Record<string, unknown>;
    return [
      {
        id: stringField(item.id),
        description: stringField(item.description),
        createdAt: stringField(item.createdAt) || stringField(item.created_at),
      },
    ];
  });
}

function stringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

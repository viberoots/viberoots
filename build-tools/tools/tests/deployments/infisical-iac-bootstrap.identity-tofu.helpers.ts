export function fakeCredentialApi(opts: { remoteSecrets: unknown[]; clientSecret?: string }) {
  return {
    descriptions: [] as string[],
    request: async function (method: string, endpoint: string, body?: { description?: string }) {
      if (endpoint.endsWith("/client-secrets") && method === "GET")
        return { clientSecrets: opts.remoteSecrets };
      if (endpoint.endsWith("/client-secrets") && method === "POST") {
        this.descriptions.push(body?.description || "");
        return { clientSecret: opts.clientSecret ?? "new-secret" };
      }
      return { identityUniversalAuth: { clientId: "client-id" } };
    },
  };
}

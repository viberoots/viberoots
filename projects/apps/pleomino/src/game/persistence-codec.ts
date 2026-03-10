export function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromBase64Url(base64url: string): string {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = (4 - (padded.length % 4)) % 4;
  return `${padded}${"=".repeat(paddingLength)}`;
}

export function encodeBytesBase64Url(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return toBase64Url(Buffer.from(bytes).toString("base64"));
  }
  if (typeof btoa === "undefined") {
    throw new Error("Missing base64 primitives for URL state encoding");
  }
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return toBase64Url(btoa(binary));
}

export function decodeBase64UrlBytes(value: string): Uint8Array | null {
  try {
    const base64 = fromBase64Url(value);
    if (typeof Buffer !== "undefined") {
      return Uint8Array.from(Buffer.from(base64, "base64"));
    }
    if (typeof atob === "undefined") {
      return null;
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

export function encodeUtf8Base64Url(value: string): string {
  if (typeof Buffer !== "undefined") {
    return toBase64Url(Buffer.from(value, "utf8").toString("base64"));
  }
  if (typeof TextEncoder === "undefined" || typeof btoa === "undefined") {
    throw new Error("Missing UTF-8/base64 primitives for URL state encoding");
  }
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return toBase64Url(btoa(binary));
}

export function decodeUtf8Base64Url(value: string): string | null {
  try {
    const base64 = fromBase64Url(value);
    if (typeof Buffer !== "undefined") {
      return Buffer.from(base64, "base64").toString("utf8");
    }
    if (typeof TextDecoder === "undefined" || typeof atob === "undefined") {
      return null;
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

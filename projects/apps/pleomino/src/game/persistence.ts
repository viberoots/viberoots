import { decodeCompactStateToken, encodeCompactStateToken } from "./persistence-compact";
import { decodeUtf8Base64Url, encodeUtf8Base64Url } from "./persistence-codec";
import { restorePersistedGameState, serializePersistedGameState } from "./persistence-state-v1";
import type { GameState } from "./types";

export const PLEOMINO_URL_STATE_HASH_KEY = "s";

function decodeHashStateToken(hash: string): string | null {
  const search = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  return search.get(PLEOMINO_URL_STATE_HASH_KEY);
}

function decodeLegacyHashState(hashToken: string): string | null {
  const decodedBase64 = decodeUtf8Base64Url(hashToken);
  if (decodedBase64 !== null) {
    return decodedBase64;
  }
  try {
    return decodeURIComponent(hashToken);
  } catch {
    return null;
  }
}

export { restorePersistedGameState };

export function loadPersistedGameStateFromHash(
  location: Pick<Location, "hash">,
  baseline: GameState,
): GameState | null {
  const token = decodeHashStateToken(location.hash);
  if (!token) {
    return null;
  }
  const compactRestored = decodeCompactStateToken(token, baseline);
  if (compactRestored) {
    return compactRestored;
  }
  const rawToken = decodeLegacyHashState(token);
  if (!rawToken) {
    return null;
  }
  return restorePersistedGameState(rawToken, baseline);
}

export function savePersistedGameStateToHash(
  history: Pick<History, "replaceState">,
  location: Pick<Location, "pathname" | "search" | "hash">,
  state: GameState,
): void {
  const token =
    encodeCompactStateToken(state) ?? encodeUtf8Base64Url(serializePersistedGameState(state));
  const nextHash = `#${new URLSearchParams([[PLEOMINO_URL_STATE_HASH_KEY, token]]).toString()}`;
  if (location.hash === nextHash) {
    return;
  }
  history.replaceState(null, "", `${location.pathname}${location.search}${nextHash}`);
}

export function clearPersistedGameStateFromHash(
  history: Pick<History, "replaceState">,
  location: Pick<Location, "pathname" | "search">,
): void {
  history.replaceState(null, "", `${location.pathname}${location.search}`);
}

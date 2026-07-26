export const NIX_CACHE_TRANSPORT_CURL_EXIT_CODES = [
  5, // proxy resolution
  6, // host resolution
  7, // connection failure
  16, // HTTP/2 framing
  28, // timeout
  35, // TLS connection failure
  52, // empty reply
  55, // send failure
  56, // receive failure
  92, // HTTP/2 stream failure
] as const;

export const NIX_CACHE_TRANSPORT_CURL_EXIT_CODES_SHELL =
  NIX_CACHE_TRANSPORT_CURL_EXIT_CODES.join("|");

export function isNixCacheTransportCurlExitCode(code: number): boolean {
  return (NIX_CACHE_TRANSPORT_CURL_EXIT_CODES as readonly number[]).includes(code);
}

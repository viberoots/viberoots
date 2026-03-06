export function render(url: string): string {
  const safeUrl = url.replace(/"/g, "&quot;");
  return `<main id="app" data-ssr-marker="vite">Hello from Vite SSR at ${safeUrl}</main>`;
}

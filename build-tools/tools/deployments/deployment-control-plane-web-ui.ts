#!/usr/bin/env zx-wrapper

export function controlPlaneWebUiHtml(basePath: string): string {
  const prefix = basePath === "/" ? "" : basePath;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Deployment Control Plane</title>
<link rel="stylesheet" href="${prefix}/assets/control-plane.css">
</head>
<body>
<main>
<h1>Deployment Control Plane</h1>
<nav><a href="${prefix}/">Status</a><a href="${prefix}/queue">Queue</a><a href="${prefix}/deployment">Deployment</a><a href="${prefix}/resource-graph">Resource Graph</a></nav>
<section id="app" aria-live="polite">Loading...</section>
</main>
<script>window.__CONTROL_PLANE_BASE_PATH__=${JSON.stringify(prefix)};</script>
<script src="${prefix}/assets/control-plane.js"></script>
</body>
</html>
`;
}

export const CONTROL_PLANE_WEB_UI_CSS = `
body{margin:0;font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f7f7f4;color:#20221f}
main{max-width:1120px;margin:0 auto;padding:28px}
h1{font-size:24px;margin:0 0 16px}
nav{display:flex;gap:12px;margin-bottom:20px}
a{color:#165d53}
.panel{border:1px solid #d8d8cf;background:#fff;border-radius:6px;padding:16px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f0f0eb;padding:12px;border-radius:6px}
.state{font-weight:650}
`;

export const CONTROL_PLANE_WEB_UI_JS = `
const base = window.__CONTROL_PLANE_BASE_PATH__ || "";
const sessionHeader = () => {
  const id = window.localStorage.getItem("vbr.controlPlane.sessionId");
  return id ? {"x-vbr-control-plane-session": id} : {};
};
const requestId = () => {
  if (window.crypto && window.crypto.randomUUID) return "ui-" + window.crypto.randomUUID();
  return "ui-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
};
async function api(path, renderRequestId) {
  const res = await fetch(base + path, {headers: {...sessionHeader(), "x-request-id": renderRequestId}});
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}
function panel(title, body) {
  return '<div class="panel"><h2>' + title + '</h2>' + body + '</div>';
}
function renderJson(value) {
  return '<pre>' + JSON.stringify(value, null, 2).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])) + '</pre>';
}
async function render() {
  const app = document.getElementById("app");
  const route = location.pathname.slice(base.length) || "/";
  const renderRequestId = requestId();
  if (route.startsWith("/queue")) {
    const queue = await api("/api/v1/read/queue", renderRequestId);
    app.innerHTML = panel("Queue", renderJson(queue));
    return;
  }
  if (route.startsWith("/deployment")) {
    const deploymentId = new URLSearchParams(location.search).get("deploymentId") || "";
    app.innerHTML = deploymentId
      ? panel("Deployment", renderJson(await api("/api/v1/read/deployments/" + encodeURIComponent(deploymentId), renderRequestId)))
      : panel("Deployment", "Select a deployment from a queue entry.");
    return;
  }
  if (route.startsWith("/resource-graph")) {
    app.innerHTML = panel("Resource Graph", renderJson(await api("/api/v1/read/resource-graph", renderRequestId)));
    return;
  }
  const status = await api("/api/v1/read/status", renderRequestId);
  const auth = await api("/api/v1/read/auth-context", renderRequestId);
  app.innerHTML = panel("Status", renderJson(status)) + panel("Auth", renderJson(auth));
}
render().catch(error => { document.getElementById("app").innerHTML = panel("Error", renderJson({error: String(error.message || error)})); });
`;

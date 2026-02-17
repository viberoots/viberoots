const root = document.getElementById("app");
if (root) {
  const el = document.createElement("div");
  el.textContent = "Hello, Vite Webapp!";
  root.appendChild(el);
}

document.addEventListener("DOMContentLoaded", () => {
  const el = document.getElementById("app");
  if (el) {
    el.textContent = el.textContent || "Hello";
  }
});

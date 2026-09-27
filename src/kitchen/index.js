// kitchen.leahcrhunter.com: a private app. Everything except the login page
// (and what it needs to render, or to install to a home screen) sits behind
// one shared password; /api/* reads and writes the KITCHEN_DB D1 database.

import { hasSession, login, logout } from "./auth.js";
import { handleApi } from "./api.js";

const PUBLIC = new Set([
  "/login",
  "/style.css",
  "/js/ambient.js",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-180.png",
  "/icon-192.png",
  "/icon-512.png",
]);

export async function kitchen(request, env, serveStatic) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/login" && request.method === "POST") return login(request, env);
  if (path === "/logout") return logout();
  if (PUBLIC.has(path)) return serveStatic(request);

  if (!(await hasSession(request, env))) {
    if (path.startsWith("/api/")) return Response.json({ error: "signed out" }, { status: 401 });
    return Response.redirect(new URL("/login", url), 303);
  }

  if (path.startsWith("/api/")) return handleApi(request, env, path.slice("/api/".length));

  // Private pages: never let a shared cache keep them, and always revalidate
  // so both phones pick up a new version straight away.
  const res = await serveStatic(request);
  const headers = new Headers(res.headers);
  headers.set("cache-control", "private, no-cache");
  return new Response(res.body, { status: res.status, headers });
}

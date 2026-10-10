// logs.leahcrhunter.com: who's been watching stream.leahcrhunter.com. Reads the
// stream_views table that the stream's heartbeats fill (src/stream/index.js).
// Has its own password (LOGS_PASSWORD_HASH), since stream viewers know the
// shared kitchen/stream one.

import { hasSession, login, logout } from "../kitchen/auth.js";

const COOKIE = "logs_session";
const HASH = "LOGS_PASSWORD_HASH";
const KEEP_DAYS = 90;

export async function logs(request, env, serveStatic) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/login" && request.method === "POST") return login(request, env, COOKIE, HASH);
  if (path === "/login") return serveStatic(request);
  if (path === "/logout") return logout(COOKIE);

  if (!(await hasSession(request, env, COOKIE, HASH))) {
    if (path.startsWith("/api/")) return Response.json({ error: "signed out" }, { status: 401 });
    return Response.redirect(new URL("/login", url), 303);
  }

  if (path === "/api/views") return views(env);

  const res = await serveStatic(request);
  const headers = new Headers(res.headers);
  headers.set("cache-control", "private, no-cache");
  return new Response(res.body, { status: res.status, headers });
}

// Every tab from the last KEEP_DAYS days, newest first; older rows are dropped.
async function views(env) {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - KEEP_DAYS * 86400;
  const db = env.KITCHEN_DB;
  await db.prepare("DELETE FROM stream_views WHERE started_at < ?").bind(cutoff).run();
  const { results } = await db
    .prepare(
      `SELECT id, device, started_at, last_seen, ended_at, ip, country, city, user_agent
       FROM stream_views ORDER BY started_at DESC LIMIT 2000`
    )
    .all();
  return Response.json({ now, views: results }, { headers: { "cache-control": "no-store" } });
}

// stream.leahcrhunter.com: the /watch page, its viewer count, and the live
// video itself all sit behind the kitchen's shared password (see
// src/kitchen/auth.js). The video comes from the origin server behind this
// hostname, so once signed in, anything that isn't ours is passed through to it.
// Each viewer's tab checks in to the stream_views table in D1, which
// logs.leahcrhunter.com reads (src/logs/index.js).

import { hasSession, login, logout } from "../kitchen/auth.js";

const COOKIE = "stream_session";

export async function stream(request, env, serveStatic) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/login" && request.method === "POST") return login(request, env, COOKIE);
  if (path === "/login") return serveStatic(request);
  if (path === "/logout") return logout(COOKIE);

  if (!(await hasSession(request, env, COOKIE))) {
    if (path.startsWith("/watch/")) return Response.json({ error: "signed out" }, { status: 401 });
    if (path === "/" || path === "/watch") return Response.redirect(new URL("/login", url), 303);
    return new Response("signed out", { status: 401 }); // video segments, playlists
  }

  if (path === "/") return Response.redirect(new URL("/watch", url), 302);
  if (path === "/watch") {
    const page = new URL(url);
    page.pathname = "/";
    const res = await serveStatic(new Request(page, request));
    const headers = new Headers(res.headers);
    headers.set("cache-control", "private, no-cache");
    return new Response(res.body, { status: res.status, headers });
  }
  if (path.startsWith("/watch/")) return viewers(request, env, path);

  // Everything else is the video: fetching our own hostname from inside the
  // Worker skips the Worker and goes straight to the origin.
  return fetch(request);
}

async function viewers(request, env, path) {
  // A viewer's tab checks in every 20 s.
  if (path === "/watch/heartbeat" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const id = body?.id || crypto.randomUUID();
    await logView(request, env, id, body?.device);
    return Response.json({ id });
  }

  // A tab closing marks its row as ended straight away.
  if (path === "/watch/leave" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (body?.id) {
      await env.KITCHEN_DB
        .prepare("UPDATE stream_views SET ended_at = ?1, last_seen = ?1 WHERE id = ?2")
        .bind(Math.floor(Date.now() / 1000), String(body.id).slice(0, 64))
        .run()
        .catch(() => {});
    }
    return new Response(null, { status: 204 });
  }

  return new Response("not found", { status: 404 });
}

// First check-in starts the row; later ones keep it alive. A tab that comes
// back (e.g. from the back/forward cache) after saying goodbye is reopened.
// A logging hiccup never breaks the page.
async function logView(request, env, id, device) {
  const now = Math.floor(Date.now() / 1000);
  const cf = request.cf || {};
  await env.KITCHEN_DB
    .prepare(
      `INSERT INTO stream_views (id, device, started_at, last_seen, ip, country, city, user_agent)
       VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (id) DO UPDATE SET last_seen = excluded.last_seen, ended_at = NULL`
    )
    .bind(
      String(id).slice(0, 64),
      device ? String(device).slice(0, 64) : null,
      now,
      request.headers.get("cf-connecting-ip"),
      cf.country || null,
      cf.city || null,
      (request.headers.get("user-agent") || "").slice(0, 400)
    )
    .run()
    .catch(() => {});
}

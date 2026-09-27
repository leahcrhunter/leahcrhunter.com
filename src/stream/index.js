// stream.leahcrhunter.com: the /watch page, its viewer count, and the live
// video itself all sit behind the kitchen's shared password (see
// src/kitchen/auth.js). The video comes from the origin server behind this
// hostname, so once signed in, anything that isn't ours is passed through to it.
// Viewers check in to the VIEWERS KV namespace; the page shows them as fireflies.

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
  // A viewer's tab checks in every 20 s; a check-in lasts a minute.
  if (path === "/watch/heartbeat" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const id = body?.id || crypto.randomUUID();
    await env.VIEWERS.put("viewer:" + id, "1", { expirationTtl: 60 });
    return Response.json({ id });
  }

  // A tab closing clears its spot straight away.
  if (path === "/watch/leave" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (body?.id) await env.VIEWERS.delete("viewer:" + body.id);
    return new Response(null, { status: 204 });
  }

  // How many check-ins are still alive.
  if (path === "/watch/count") {
    const list = await env.VIEWERS.list({ prefix: "viewer:" });
    const now = Date.now() / 1000;
    const count = list.keys.filter((k) => !k.expiration || k.expiration > now).length;
    return Response.json({ count });
  }

  return new Response("not found", { status: 404 });
}

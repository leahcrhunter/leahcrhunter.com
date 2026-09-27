// Maps each hostname to a folder under sites/ (see "SITES" in wrangler.jsonc),
// then serves the request from that folder's static files.
//
// Locally, `wrangler dev` pretends every request is for the first hostname in
// "routes"; use `npx wrangler dev --host cv.leahcrhunter.com` to test another site.

import { kitchen } from "./kitchen/index.js";
import { stream } from "./stream/index.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const folder = env.SITES[url.hostname];
    if (!folder) return env.ASSETS.fetch(request);

    // kitchen.leahcrhunter.com is private and has an /api/: it checks the
    // login first, then falls back to static files like every other site.
    if (folder === "kitchen") {
      return kitchen(request, env, (req) => serveFolder(req, env, folder));
    }
    // stream.leahcrhunter.com uses the same password, and passes the live
    // video through from its origin server.
    if (folder === "stream") {
      return stream(request, env, (req) => serveFolder(req, env, folder));
    }
    return serveFolder(request, env, folder);
  },
};

async function serveFolder(request, env, folder) {
  const url = new URL(request.url);
  const prefix = `/${folder}`;
  url.pathname = prefix + url.pathname;
  const res = await env.ASSETS.fetch(new Request(url, request));

  // The asset server redirects e.g. /index.html -> /; make sure the folder
  // prefix doesn't leak into that Location header.
  const loc = res.headers.get("location");
  if (loc) {
    const target = new URL(loc, url);
    if (target.pathname.startsWith(prefix + "/")) {
      target.pathname = target.pathname.slice(prefix.length);
      const headers = new Headers(res.headers);
      headers.set("location", target.pathname + target.search);
      return new Response(res.body, { status: res.status, headers });
    }
  }
  return res;
}

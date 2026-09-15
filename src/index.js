// Maps each hostname to a folder under sites/ (see "SITES" in wrangler.jsonc),
// then serves the request from that folder's static files.
//
// Locally, `wrangler dev` pretends every request is for the first hostname in
// "routes"; use `npx wrangler dev --host cv.leahcrhunter.com` to test another site.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const folder = env.SITES[url.hostname];
    if (!folder) return env.ASSETS.fetch(request);

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
  },
};

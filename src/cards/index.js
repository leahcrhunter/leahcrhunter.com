// cards.leahcrhunter.com: Talent Against Humanity is peer-to-peer, but players
// on different networks can't always connect to each other directly. /api/ice
// hands the page short-lived login details for Cloudflare's TURN relay, which
// carries the game's messages when a direct link fails. Everything else is the
// game's static files.
//
// Logins only go to games that exist, so the relay's free allowance can't be
// casually used for other things:
//   /api/ice?host=ABCD  the host's page, creating room ABCD. Registers the
//                       room for two hours; each address can create a few
//                       rooms an hour.
//   /api/ice?join=ABCD  a player joining room ABCD; only works while ABCD is
//                       registered.
// Anything else gets STUN only (direct connections, no relay). Rooms are kept
// in KV under "cards:" (the CARDS_ROOMS binding in wrangler.jsonc).
//
// Needs two secrets from the Cloudflare dashboard (Realtime > TURN Server):
//   TURN_KEY_ID and TURN_KEY_API_TOKEN
// Without them the game still works, just only for players who can connect
// directly (e.g. on the same wifi).

const STUN_ONLY = [{ urls: "stun:stun.cloudflare.com:3478" }];
const TTL = 2 * 60 * 60; // seconds: how long a room and its relay logins last
const ROOMS_PER_HOUR = 10; // per IP address
const ROOM_CODE = /^[A-HJKMNP-Z]{4}$/; // matches CODE_CHARS in the game's app.js

export async function cards(request, env, serveStatic) {
  const url = new URL(request.url);
  if (url.pathname === "/api/ice") return ice(request, env, url);
  return serveStatic(request);
}

async function ice(request, env, url) {
  // Only the game's own page (or someone typing the address in) should be
  // asking; this stops other sites using the relay on our free allowance.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return new Response("forbidden", { status: 403 });
  }

  const hostCode = url.searchParams.get("host");
  const joinCode = url.searchParams.get("join");
  let allowed = false;
  if (hostCode && ROOM_CODE.test(hostCode)) {
    allowed = await registerRoom(request, env, hostCode);
  } else if (joinCode && ROOM_CODE.test(joinCode)) {
    allowed = (await env.CARDS_ROOMS.get("cards:room:" + joinCode)) !== null;
  }

  const iceServers = allowed ? await turnServers(env) : STUN_ONLY;
  return Response.json({ iceServers }, { headers: { "cache-control": "no-store" } });
}

// Records a new room, unless this address has already made too many lately.
async function registerRoom(request, env, code) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const hour = Math.floor(Date.now() / 3_600_000);
  const countKey = `cards:hosts:${ip}:${hour}`;
  const count = Number(await env.CARDS_ROOMS.get(countKey)) || 0;
  if (count >= ROOMS_PER_HOUR) return false;

  await Promise.all([
    env.CARDS_ROOMS.put(countKey, String(count + 1), { expirationTtl: 3600 }),
    env.CARDS_ROOMS.put("cards:room:" + code, "1", { expirationTtl: TTL }),
  ]);
  return true;
}

async function turnServers(env) {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return STUN_ONLY;
  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ttl: TTL }),
      }
    );
    if (!res.ok) throw new Error(`TURN credentials: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.iceServers.map(withoutPort53);
  } catch (e) {
    console.error(e);
    return STUN_ONLY;
  }
}

// Cloudflare includes port 53 addresses, which browsers block; trying them
// only slows the connection down.
function withoutPort53(server) {
  const urls = [].concat(server.urls).filter((u) => !/:53(\?|$)/.test(u));
  return { ...server, urls };
}

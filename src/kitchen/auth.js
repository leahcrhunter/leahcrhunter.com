// One shared password, checked against a PBKDF2 hash in the
// KITCHEN_PASSWORD_HASH secret (make one with scripts/kitchen-password.mjs).
// A correct password gets a long-lived signed cookie, so each device logs in once.
// stream.leahcrhunter.com uses the same password with its own cookie name.
// Failed attempts are counted in D1: 5 per IP per 15 minutes, 50 overall per hour.

const COOKIE = "kitchen_session";
const MAX_AGE = 400 * 24 * 60 * 60; // the longest browsers will keep a cookie
const PER_IP = { limit: 5, window: 15 * 60 };
const OVERALL = { limit: 50, window: 60 * 60 };

const enc = new TextEncoder();

export async function hasSession(request, env, cookie = COOKIE) {
  if (!env.KITCHEN_SESSION_SECRET || !env.KITCHEN_PASSWORD_HASH) return false;
  const token = readCookie(request, cookie);
  if (!token) return false;
  const [issued, sig] = token.split(".");
  if (!/^\d+$/.test(issued) || !sig) return false;
  if (Date.now() / 1000 - Number(issued) > MAX_AGE) return false;
  return safeEqual(sig, await sign(env, issued));
}

export async function login(request, env, cookie = COOKIE) {
  if (!env.KITCHEN_SESSION_SECRET || !env.KITCHEN_PASSWORD_HASH) return back("setup");

  const db = env.KITCHEN_DB;
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const now = Math.floor(Date.now() / 1000);
  const counts = await db
    .prepare(
      `SELECT (SELECT count(*) FROM login_attempts WHERE ip = ?1 AND at > ?2) AS mine,
              (SELECT count(*) FROM login_attempts WHERE at > ?3) AS everyone`
    )
    .bind(ip, now - PER_IP.window, now - OVERALL.window)
    .first();
  if (counts.mine >= PER_IP.limit || counts.everyone >= OVERALL.limit) return back("wait");

  const form = await request.formData().catch(() => null);
  const password = String(form?.get("password") ?? "");

  if (!(await checkPassword(password, env.KITCHEN_PASSWORD_HASH))) {
    await db.prepare("INSERT INTO login_attempts (ip, at) VALUES (?, ?)").bind(ip, now).run();
    return back("wrong");
  }

  await db.prepare("DELETE FROM login_attempts WHERE ip = ? OR at < ?").bind(ip, now - 86400).run();
  const issued = String(now);
  const setCookie =
    `${cookie}=${issued}.${await sign(env, issued)}; Max-Age=${MAX_AGE}; ` +
    `Path=/; HttpOnly; Secure; SameSite=Lax`;
  return new Response(null, { status: 303, headers: { location: "/", "set-cookie": setCookie } });
}

export function logout(cookie = COOKIE) {
  return new Response(null, {
    status: 303,
    headers: { location: "/login", "set-cookie": `${cookie}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax` },
  });
}

function back(reason) {
  return new Response(null, { status: 303, headers: { location: `/login?e=${reason}` } });
}

// The password hash is part of what's signed, so changing the password
// signs every device out.
async function sign(env, issued) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(env.KITCHEN_SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${issued}.${env.KITCHEN_PASSWORD_HASH}`));
  return b64url(mac);
}

// Stored as "pbkdf2-sha256:<iterations>:<salt>:<hash>", both base64url.
async function checkPassword(password, stored) {
  const [scheme, iterations, salt, expected] = String(stored).trim().split(":");
  if (scheme !== "pbkdf2-sha256" || !expected) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromB64url(salt), iterations: Number(iterations) },
    key,
    256
  );
  return safeEqual(b64url(bits), expected);
}

function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

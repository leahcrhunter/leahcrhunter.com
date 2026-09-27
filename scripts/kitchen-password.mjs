// Makes the KITCHEN_PASSWORD_HASH secret for kitchen.leahcrhunter.com.
//
//   node scripts/kitchen-password.mjs
//
// Type the shared password when asked (it isn't echoed), then paste the line it
// prints into `npx wrangler secret put KITCHEN_PASSWORD_HASH`.
// Must match checkPassword() in src/kitchen/auth.js.

import { createInterface } from "node:readline";

const ITERATIONS = 100000; // the most Cloudflare Workers allow for PBKDF2

// The prompt goes to stderr, so `$(node scripts/kitchen-password.mjs)` captures only the hash.
const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
rl._writeToOutput = (s) => { if (s.includes("password")) process.stderr.write(s); };
rl.question("kitchen password: ", async (password) => {
  rl.close();
  process.stderr.write("\n");
  if (password.length < 8) {
    console.error("use at least 8 characters");
    process.exit(1);
  }
  const b64url = (buf) => Buffer.from(buf).toString("base64url");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);
  console.log(`pbkdf2-sha256:${ITERATIONS}:${b64url(salt)}:${b64url(bits)}`);
});

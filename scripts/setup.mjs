// Easy setup helper. Run it with:  node scripts/setup.mjs     (or double-click SETUP-WEBSITE.bat on Windows)
// It asks for your Neon database link, makes a secret, writes .env, builds the database tables,
// and then prints exactly what to paste into Vercel and into the Minecraft plugin.
import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, given) => (given ?? (await rl.question(q))).trim();

console.log("\n=== TokenStore easy setup ===\n");

let url = await ask("1) Paste your Neon database link (starts with postgresql://) and press Enter:\n> ", arg("url"));
url = url.replace(/^["']|["']$/g, "").replace(/([?&])channel_binding=[^&]*&?/, "$1").replace(/[?&]$/, "");
if (!/^postgres(ql)?:\/\//.test(url)) {
  console.log("\nThat does not look like a database link. It must start with postgresql://  (copy it from Neon > Connect).");
  process.exit(1);
}
if (/-pooler\./.test(url)) console.log("\nNote: this looks like the 'pooled' link. It usually works, but if the next step fails, turn OFF 'Connection pooling' in Neon and copy the link again.");

let site = await ask("\n2) Paste your Vercel website address (like https://my-store.vercel.app), or just press Enter if you don't have it yet:\n> ", arg("site"));
site = site.replace(/\/+$/, "");
if (site && !/^https?:\/\/[^/\s]+$/.test(site)) {
  console.log("\nThe website address must be ONLY the address, with nothing after it. Example: https://my-store.vercel.app");
  process.exit(1);
}

// Keep an existing secret so re-running this never breaks a working plugin.
let secret = "";
if (existsSync(".env")) secret = /^TOKENSTORE_SERVER_SECRET="?([^"\r\n]{32,})"?/m.exec(readFileSync(".env", "utf8"))?.[1] ?? "";
const reused = Boolean(secret);
if (!secret) secret = randomBytes(32).toString("hex");

writeFileSync(".env", `DATABASE_URL="${url}"\nTOKENSTORE_SERVER_SECRET="${secret}"\nSITE_URL="${site || "http://localhost:3000"}"\n`);
console.log("\nSaved your settings to web/.env" + (reused ? " (kept your existing secret)" : ""));

const run = (cmd, what) => {
  console.log(`\n--- ${what} ---`);
  try { execSync(cmd, { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } }); }
  catch {
    console.log(`\nSTEP FAILED: ${what}.\nMost common reasons: the database link was copied wrong, or Neon is waking up (wait 20 seconds and run this again).`);
    process.exit(1);
  }
};
run("npx prisma migrate deploy", "Creating the database tables");
run("npx prisma db seed", "Adding the sample shop items");

console.log(`
=============================================================
 DONE. The database is ready.
=============================================================

STEP A - In Vercel (Project > Settings > Environment Variables) add these 3, then Redeploy:

   DATABASE_URL              ${url}
   TOKENSTORE_SERVER_SECRET  ${secret}
   SITE_URL                  ${site || "(your Vercel address, e.g. https://my-store.vercel.app)"}

STEP B - In Minecraft, open  plugins/TokenStore/config.yml  and set these 3 lines, then restart the server:

   api:
     url: "${site || "https://YOUR-VERCEL-ADDRESS"}"
     server-name: "main"
     secret: "${secret}"

STEP C - Check it: open  ${site || "https://YOUR-VERCEL-ADDRESS"}/api/health  in your browser. It should say "ok":true.
         In the game, type /tokens admin status (as an op). It should say "connected".

Keep the secret private. Anyone who has it can give themselves tokens.
`);
rl.close();

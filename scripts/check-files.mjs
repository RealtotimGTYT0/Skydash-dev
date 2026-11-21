// Runs before the website is built. If part of the project was not uploaded (a common problem when dragging files
// into GitHub), the normal build error is confusing. This prints the plain-English version instead.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const src = join(root, "src");
const missing = new Map();

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "generated") walk(p); continue; }
    if (!/\.(ts|tsx|mjs)$/.test(name)) continue;
    const text = readFileSync(p, "utf8");
    for (const m of text.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
      const target = resolve(dirname(p), m[1]);
      if (!existsSync(target) && !["", ".ts", ".tsx"].some((e) => existsSync(target + e))) {
        const rel = target.slice(root.length + 1);
        if (!missing.has(rel)) missing.set(rel, p.slice(root.length + 1));
      }
    }
  }
}
walk(src);

if (missing.size > 0) {
  console.error("\n==================== PROJECT FILES ARE MISSING ====================");
  console.error("Part of the website was not uploaded to GitHub. These files are needed but not there:\n");
  for (const [file, by] of missing) console.error(`  - ${file}   (used by ${by})`);
  console.error("\nFix: upload the WHOLE 'web' folder again from the newest zip (all files and folders inside it),");
  console.error("replacing what is on GitHub. Do not pick files one by one. Then Vercel builds again.");
  console.error("===================================================================\n");
  process.exit(1);
}

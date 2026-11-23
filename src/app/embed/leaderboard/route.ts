import { getPrisma } from "../../../lib/db.ts";
import { leaderboard } from "../../../services/queries.ts";
import { STATIC_THEMES, THEME_COLORS, getAppearance } from "../../../services/appearance.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * /embed/leaderboard - a page made to be pasted into Discord (or any chat that previews links). Discord reads the
 * <meta property="og:..."> tags, and people who open the link see a small themed page.
 *
 * Options (all optional, in the address):
 *   theme=forest                          a normal theme (dark light midnight ocean forest sunset). Staff-only animated themes are NOT allowed here.
 *   limit=10                              1 to 25 rows
 *   show-hidden=true|false                include players an admin hid (default false)
 *   show-leaderboard_banned=true|false    include leaderboard-banned players, marked and coloured (default false)
 *   show-leaderboard_banned-color=RED     colour for banned players; giving a colour also turns banned players on
 *   show-hidden-lb-banned=true|false      include players that are both hidden and banned (default false)
 */
const NAMED: Record<string, string> = {
  RED: "#ef4444", ORANGE: "#f97316", YELLOW: "#eab308", GREEN: "#22c55e", AQUA: "#06b6d4", BLUE: "#3b82f6",
  PURPLE: "#a855f7", PINK: "#ec4899", GRAY: "#9ca3af", GREY: "#9ca3af", WHITE: "#ffffff", BLACK: "#000000",
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** true / false from the address; anything else keeps the default. */
function flag(v: string | null, dflt: boolean): boolean {
  if (v === null) return dflt;
  const x = v.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(x)) return true;
  if (["false", "0", "no", "off"].includes(x)) return false;
  return dflt;
}

/** A colour name or #rrggbb only; anything else is ignored, so nothing from the address can reach the page's CSS. */
function colour(v: string | null): string | null {
  if (!v) return null;
  const x = v.trim();
  if (NAMED[x.toUpperCase()]) return NAMED[x.toUpperCase()]!;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(x);
  return m ? `#${m[1]!.toLowerCase()}` : null;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams;
  const db = getPrisma();

  const look = await getAppearance(db).catch(() => null);
  const asked = (q.get("theme") ?? "").trim().toLowerCase();
  const fallback = look && (STATIC_THEMES as readonly string[]).includes(look.defaultTheme) ? look.defaultTheme : "dark";
  const theme = (STATIC_THEMES as readonly string[]).includes(asked) ? asked : fallback;   // animated themes are never allowed in an embed
  const c = THEME_COLORS[theme]!;

  const bannedColour = colour(q.get("show-leaderboard_banned-color") ?? q.get("leaderboard_banned-color"));
  const showBanned = flag(q.get("show-leaderboard_banned"), bannedColour !== null);
  const bannedCss = bannedColour ?? NAMED.RED!;
  const showHidden = flag(q.get("show-hidden"), false);
  const showHiddenBanned = flag(q.get("show-hidden-lb-banned"), false);
  const limit = Math.min(Math.max(parseInt(q.get("limit") ?? "10", 10) || 10, 1), 25);

  const rows = await leaderboard(db, limit, { showHidden, showBanned, showHiddenBanned }).catch(() => []);
  const site = look?.siteName ?? "TokenStore";
  const origin = url.origin;
  const mark = (r: { hidden: boolean; banned: boolean }) => (r.banned ? " (banned)" : "") + (r.hidden ? " (hidden)" : "");
  const description = rows.length === 0 ? "Nobody on the leaderboard yet."
    : rows.map((r) => `#${r.rank} ${r.username}${mark(r)} - ${r.balance} tokens`).join("\n");
  const logo = look?.logoUrl ? (look.logoUrl.startsWith("/") ? origin + look.logoUrl : look.logoUrl) : null;

  const list = rows.map((r) => {
    const colourCss = r.banned ? `color:${bannedCss}` : "";
    return `<li style="${colourCss}${r.hidden ? ";opacity:.6" : ""}"><span>#${r.rank} ${esc(r.username)}${esc(mark(r))}</span><b>${r.balance}</b></li>`;
  }).join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(site)} - Top token holders</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(site)}">
<meta property="og:title" content="Top token holders"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(origin + "/embed/leaderboard")}">
${logo ? `<meta property="og:image" content="${esc(logo)}">` : ""}
<meta name="theme-color" content="${c.accent}"><meta name="robots" content="noindex">
<style>
body{margin:0;background:${c.bg};color:${c.text};font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}
.card{background:${c.card};border:1px solid ${c.line};border-radius:12px;padding:20px 24px;min-width:280px;max-width:420px;width:90%}
h1{margin:0 0 12px;font-size:18px;color:${c.accent}} ol{list-style:none;margin:0;padding:0}
li{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid ${c.line}} li:last-child{border:0}
b{color:${c.accent}} p{color:${c.muted};margin:0}
</style></head><body><div class="card"><h1>${esc(site)}: top token holders</h1>
${rows.length ? `<ol>${list}</ol>` : "<p>Nobody on the leaderboard yet.</p>"}</div></body></html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, s-maxage=60, stale-while-revalidate=300", "x-content-type-options": "nosniff" },
  });
}

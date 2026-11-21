import { getPrisma } from "../../lib/db.ts";
import { getAppearance } from "../../services/appearance.ts";

export const dynamic = "force-dynamic";

/** /discord sends visitors to the invite link the admin set in Admin > Appearance. */
export async function GET() {
  const a = await getAppearance(getPrisma()).catch(() => null);
  if (!a?.discordUrl) return new Response("No Discord link has been set up yet.", { status: 404 });
  // 307 (not 301) so a changed invite link takes effect immediately and browsers never cache the old one.
  return new Response(null, { status: 307, headers: { location: a.discordUrl, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

import { getPrisma } from "../../../lib/db.ts";
import { getImage } from "../../../services/images.ts";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const img = await getImage(getPrisma(), id).catch(() => null);
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(img.data), {
    headers: {
      "content-type": img.mime,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      // The id never changes what it shows, so browsers may keep it for a year.
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

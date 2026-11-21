import type { Db } from "../lib/db.ts";
import { writeAudit } from "../lib/audit.ts";
import { AppError } from "../lib/errors.ts";
import { parseImageRef } from "../lib/commands.ts";
import { getSetting, setSetting } from "./settings.ts";

export const STATIC_THEMES = ["dark", "light", "midnight", "ocean", "forest", "sunset"] as const;
/** Animated themes can only be chosen by admins (personally or as the site default). */
export const ANIMATED_THEMES = ["aurora", "starfield", "neon"] as const;
export const ALL_THEMES: readonly string[] = [...STATIC_THEMES, ...ANIMATED_THEMES];
export const isAnimated = (t: string) => (ANIMATED_THEMES as readonly string[]).includes(t);

const K = { siteName: "site.name", logo: "site.logo_url", background: "site.background_url", theme: "site.theme" } as const;

export interface Appearance { siteName: string; logoUrl: string | null; backgroundUrl: string | null; defaultTheme: string }

export async function getAppearance(db: Db): Promise<Appearance> {
  const [name, logo, bg, theme] = await Promise.all([K.siteName, K.logo, K.background, K.theme].map((k) => getSetting(db, k)));
  return { siteName: name || "TokenStore", logoUrl: logo || null, backgroundUrl: bg || null, defaultTheme: theme && ALL_THEMES.includes(theme) ? theme : "dark" };
}

export async function setAppearance(db: Db, p: Appearance, actor: { actorUserId?: string | null; actorLabel?: string | null }) {
  const siteName = p.siteName.trim();
  if (!siteName || siteName.length > 40) throw new AppError("VALIDATION", "Site name must be 1 to 40 characters");
  const logo = parseImageRef(p.logoUrl ?? "", "Logo link");
  const bg = parseImageRef(p.backgroundUrl ?? "", "Background image link");
  if (!ALL_THEMES.includes(p.defaultTheme)) throw new AppError("VALIDATION", "Unknown theme");
  await db.$transaction(async (tx) => {
    await setSetting(tx, K.siteName, siteName);
    await setSetting(tx, K.logo, logo ?? "");
    await setSetting(tx, K.background, bg ?? "");
    await setSetting(tx, K.theme, p.defaultTheme);
    await writeAudit(tx, { ...actor, action: "appearance.update", details: { theme: p.defaultTheme } });
  });
}

/**
 * Which theme to actually show. A personal choice wins, but an animated one is only honoured for admins,
 * so a regular player cannot get one by editing a cookie.
 */
export function effectiveTheme(personal: string | undefined, siteDefault: string, isAdmin: boolean): string {
  if (personal && ALL_THEMES.includes(personal) && (!isAnimated(personal) || isAdmin)) return personal;
  return siteDefault;
}

import "./globals.css";
import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { getPrisma } from "../lib/db.ts";
import { ALL_THEMES, STATIC_THEMES, ANIMATED_THEMES, effectiveTheme, getAppearance, type Appearance } from "../services/appearance.ts";
import { currentAuth, csrfToken } from "../web/session.ts";
import { logoutAction, setThemeAction } from "./actions.ts";

export const metadata: Metadata = { title: "TokenStore", description: "Earn tokens by playing. Spend them in the shop." };
export const dynamic = "force-dynamic";

const FALLBACK: Appearance = { siteName: "TokenStore", logoUrl: null, backgroundUrl: null, defaultTheme: "dark" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const auth = await currentAuth().catch(() => null);
  const csrf = auth ? await csrfToken() : "";
  const look = await getAppearance(getPrisma()).catch(() => FALLBACK);
  const isAdmin = auth?.user.role === "ADMIN";
  const theme = effectiveTheme((await cookies()).get("ts_theme")?.value, look.defaultTheme, isAdmin);
  const bgStyle = look.backgroundUrl ? ({ "--bg-image": `url("${look.backgroundUrl}")` } as CSSProperties) : undefined;
  const choices: readonly string[] = isAdmin ? ALL_THEMES : STATIC_THEMES;
  return (
    <html lang="en" data-theme={theme}>
      <body className={look.backgroundUrl ? "has-bg" : undefined} style={bgStyle}>
        <header className="border-b border-zinc-800">
          <nav className="mx-auto flex max-w-4xl flex-wrap items-center gap-4 px-4 py-3 text-sm">
            <Link href="/" className="flex items-center gap-2 font-bold text-zinc-100">
              {look.logoUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={look.logoUrl} alt="" className="h-7 w-auto" referrerPolicy="no-referrer" />}
              <span>{look.siteName}</span>
            </Link>
            <Link href="/shop">Shop</Link>
            <Link href="/vote">Vote</Link>
            <span className="flex-1" />
            <details className="relative">
              <summary className="btn-ghost cursor-pointer list-none">Theme</summary>
              <div className="absolute right-0 z-10 mt-2 w-44 space-y-1 rounded-lg border border-zinc-700 bg-zinc-900 p-2 shadow-lg">
                {choices.map((t) => (
                  <form key={t} action={setThemeAction}><input type="hidden" name="theme" value={t} />
                    <button className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-zinc-800 ${t === theme ? "text-amber-400" : "text-zinc-300"}`}>
                      {t[0]!.toUpperCase() + t.slice(1)}{(ANIMATED_THEMES as readonly string[]).includes(t) ? " (animated)" : ""}
                    </button></form>))}
              </div>
            </details>
            {auth ? (
              <>
                {isAdmin && <Link href="/admin">Admin</Link>}
                <Link href="/account">{auth.user.minecraftUsername}</Link>
                <form action={logoutAction}><input type="hidden" name="_csrf" value={csrf} /><button className="btn-ghost">Sign out</button></form>
              </>
            ) : (
              <><Link href="/login">Sign in</Link><Link href="/register" className="btn">Register</Link></>
            )}
          </nav>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}

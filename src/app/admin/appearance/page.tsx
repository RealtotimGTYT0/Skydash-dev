import { notFound, redirect } from "next/navigation";
import { getPrisma } from "../../../lib/db.ts";
import { csrfToken, currentAuth } from "../../../web/session.ts";
import { ANIMATED_THEMES, STATIC_THEMES, getAppearance } from "../../../services/appearance.ts";
import { saveAppearanceAction } from "../../actions.ts";
import { AdminNav } from "../AdminNav.tsx";
import { Notice } from "../../Notice.tsx";

export default async function AdminAppearance({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const auth = await currentAuth();
  if (!auth) redirect("/login");
  if (auth.user.role !== "ADMIN" || auth.user.status !== "ACTIVE") notFound();
  const { e, ok } = await searchParams;
  const a = await getAppearance(getPrisma());
  const csrf = await csrfToken();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin</h1>
      <AdminNav current="appearance" />
      <Notice error={e} ok={ok} />
      <form action={saveAppearanceAction} className="card space-y-4" encType="multipart/form-data">
        <input type="hidden" name="_csrf" value={csrf} />
        <div><label className="label" htmlFor="siteName">Site name</label><input id="siteName" name="siteName" defaultValue={a.siteName} className="input" required maxLength={40} /></div>
        <div><label className="label" htmlFor="logoFile">Logo: upload a file</label><input id="logoFile" name="logoFile" type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="input" /></div>
        <div><label className="label" htmlFor="logoUrl">…or logo link (https://…, empty = no logo)</label><input id="logoUrl" name="logoUrl" defaultValue={a.logoUrl ?? ""} className="input" placeholder="https://i.imgur.com/logo.png" /></div>
        <div><label className="label" htmlFor="backgroundFile">Background: upload a file</label><input id="backgroundFile" name="backgroundFile" type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="input" /></div>
        <div><label className="label" htmlFor="backgroundUrl">…or background link (https://…, empty = none)</label><input id="backgroundUrl" name="backgroundUrl" defaultValue={a.backgroundUrl ?? ""} className="input" placeholder="https://i.imgur.com/background.jpg" /></div>
        <div><label className="label" htmlFor="defaultTheme">Default theme for visitors</label>
          <select id="defaultTheme" name="defaultTheme" defaultValue={a.defaultTheme} className="input">
            <optgroup label="Normal">{STATIC_THEMES.map((t) => <option key={t} value={t}>{t}</option>)}</optgroup>
            <optgroup label="Animated (only admins can pick these for themselves)">{ANIMATED_THEMES.map((t) => <option key={t} value={t}>{t}</option>)}</optgroup>
          </select></div>
        <button className="btn">Save appearance</button>
        <p className="text-xs text-zinc-500">Uploaded pictures (PNG, JPG, GIF, WebP, up to 1.5 MB) are stored in your database. A new upload replaces the link above it. Links must be https. Every visitor can pick their own normal theme from the Theme menu; animated themes can only be chosen by admins.</p>
      </form>
    </div>
  );
}

"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPrisma } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { adminAdjustTokens } from "../services/admin-tokens.ts";
import { login, registerUser, reissueLinkCode } from "../services/auth.ts";
import { createPurchase } from "../services/purchases.ts";
import { requireAdmin, requireLinked } from "../services/authz.ts";
import { revokeSession } from "../services/sessions.ts";
import { setEarningFromAdmin, validateRate } from "../services/settings.ts";
import { findAccountByUsername } from "../services/queries.ts";
import { revalidatePath } from "next/cache";
import { ALL_THEMES, isAnimated, setAppearance } from "../services/appearance.ts";
import { deleteCategory, deleteProduct, saveCategory, saveProduct } from "../services/catalog-admin.ts";
import { saveImage } from "../services/images.ts";
import { parseVoteSites, replaceVoteSites, setVoteConfig } from "../services/votes.ts";
import { clearSessionCookies, clientContext, currentAuth, FLASH_COOKIE, guard, safeMessage, setSessionCookies } from "../web/session.ts";

const fail = (to: string, e: unknown): never => redirect(`${to}?e=${encodeURIComponent(safeMessage(e))}`);
const str = (f: FormData, k: string) => String(f.get(k) ?? "");

async function flashCode(code: string) {
  (await cookies()).set(FLASH_COOKIE, code, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/link", maxAge: 900 });
}

export async function registerAction(form: FormData) {
  let code: string;
  try {
    const r = await registerUser(getPrisma(), {
      displayName: str(form, "displayName"), minecraftUsername: str(form, "minecraftUsername"),
      accountType: str(form, "accountType"), password: str(form, "password"), confirmPassword: str(form, "confirmPassword"),
    }, await clientContext());
    await setSessionCookies(r.session);
    code = r.linkCode;
  } catch (e) { return fail("/register", e); }
  await flashCode(code);
  redirect("/link");
}

export async function loginAction(form: FormData) {
  try {
    const r = await login(getPrisma(), { username: str(form, "username"), password: str(form, "password") }, await clientContext());
    await setSessionCookies(r.session);
  } catch (e) { return fail("/login", e); }
  redirect("/account");
}

export async function logoutAction(form: FormData) {
  try {
    const ctx = await guard(form);
    await revokeSession(getPrisma(), ctx.session.id);
  } catch { /* already signed out */ }
  await clearSessionCookies();
  redirect("/");
}

export async function newCodeAction(form: FormData) {
  try {
    const ctx = await guard(form);
    const r = await reissueLinkCode(getPrisma(), ctx.user.id, await clientContext());
    await flashCode(r.linkCode);
  } catch (e) { return fail("/link", e); }
  redirect("/link");
}

export async function buyAction(form: FormData) {
  let message = "";
  try {
    const ctx = requireLinked(await guard(form));
    const db = getPrisma();
    const account = await db.minecraftAccount.findUnique({ where: { userId: ctx.user.id } });
    if (!account) throw new AppError("ACCOUNT_NOT_LINKED", "Link your Minecraft account first");
    const key = str(form, "idempotencyKey");
    if (key.length < 8 || key.length > 128) throw new AppError("VALIDATION", "Please reload the page and try again");
    // Only the product id and the idempotency key come from the browser. Price and commands come from the database.
    const r = await createPurchase(db, { mcAccountId: account.id, userId: ctx.user.id, productId: str(form, "productId"), source: "WEB", idempotencyKey: `web-${key}` });
    message = r.replayed ? "That purchase was already completed." : `Bought ${r.purchase.productName}. It will be delivered next time you are online. Balance: ${r.balance}`;
  } catch (e) { return fail("/shop", e); }
  redirect(`/shop?ok=${encodeURIComponent(message)}`);
}

export async function adminAdjustAction(form: FormData) {
  let message = "";
  try {
    const ctx = requireAdmin(await guard(form));
    const db = getPrisma();
    const action = str(form, "action");
    if (action !== "give" && action !== "take" && action !== "set") throw new AppError("VALIDATION", "Unknown action");
    const amount = Number(str(form, "amount"));
    const account = await findAccountByUsername(db, str(form, "username").trim());
    if (!account) throw new AppError("NOT_FOUND", "That player has never joined the server");
    const r = await adminAdjustTokens(db, {
      mcAccountId: account.id, action, amount, idempotencyKey: `web-admin-${randomUUID()}`,
      actorUserId: ctx.user.id, actorLabel: `web:${ctx.user.minecraftUsername}`, reason: `${action} from admin panel`,
    });
    message = `${account.username}: new balance ${r.balance}`;
  } catch (e) { return fail("/admin", e); }
  redirect(`/admin?ok=${encodeURIComponent(message)}`);
}

export async function adminRateAction(form: FormData) {
  let message = "";
  try {
    requireAdmin(await guard(form));
    const minutes = Number(str(form, "minutes"));
    if (!Number.isFinite(minutes)) throw new AppError("VALIDATION", "Enter a number of minutes");
    const seconds = Math.round(minutes * 60);
    validateRate(seconds);
    await setEarningFromAdmin(getPrisma(), { secondsPerToken: seconds, source: "admin" });
    message = `Earning rate set: 1 token per ${minutes} minutes`;
  } catch (e) { return fail("/admin", e); }
  redirect(`/admin?ok=${encodeURIComponent(message)}`);
}

export async function adminVoteAction(form: FormData) {
  let message = "";
  try {
    requireAdmin(await guard(form));
    const db = getPrisma();
    const sites = parseVoteSites(str(form, "sites"));
    await setVoteConfig(db, { tokens: Number(str(form, "tokens")), cooldownHours: Number(str(form, "cooldownHours")) });
    await replaceVoteSites(db, sites);
    message = `Voting saved: ${sites.length} site(s)`;
  } catch (e) { return fail("/admin", e); }
  redirect(`/admin?ok=${encodeURIComponent(message)}`);
}

// ------------------------------------------------------------------ theme
export async function setThemeAction(form: FormData) {
  const theme = str(form, "theme");
  const ctx = await currentAuth();
  // Animated themes are admin-only. Enforced here (and again when rendering), so a crafted request gets nothing.
  if (!ALL_THEMES.includes(theme) || (isAnimated(theme) && ctx?.user.role !== "ADMIN")) return;
  (await cookies()).set("ts_theme", theme, { sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}

// ------------------------------------------------------------------ shop editor
const actorOf = (ctx: { user: { id: string; minecraftUsername: string } }) => ({ actorUserId: ctx.user.id, actorLabel: `web:${ctx.user.minecraftUsername}` });
/** An uploaded picture file wins over the link box; with no file, the link box (https link, or an earlier /img/ upload) is used. */
async function pictureFrom(form: FormData, fileKey: string, linkKey: string, ctx: Parameters<typeof actorOf>[0]): Promise<string> {
  const f = form.get(fileKey);
  if (f instanceof File && f.size > 0) {
    const a = actorOf(ctx);
    return saveImage(getPrisma(), new Uint8Array(await f.arrayBuffer()), a.actorLabel, a.actorUserId);
  }
  return str(form, linkKey);
}
const back = (to: string, m: { ok?: string; e?: string }) => redirect(`${to}?${m.e ? "e" : "ok"}=${encodeURIComponent(m.e ?? m.ok ?? "")}`);

export async function saveCategoryAction(form: FormData) {
  let msg = "";
  try {
    const ctx = requireAdmin(await guard(form));
    await saveCategory(getPrisma(), { id: str(form, "id") || undefined, name: str(form, "name"), description: str(form, "description"),
      iconMaterial: str(form, "iconMaterial"), sortOrder: str(form, "sortOrder") || "0", enabled: form.get("enabled") === "on" }, actorOf(ctx));
    msg = "Category saved";
  } catch (e) { return back("/admin/shop", { e: safeMessage(e) }); }
  back("/admin/shop", { ok: msg });
}

export async function deleteCategoryAction(form: FormData) {
  let msg = "";
  try {
    const ctx = requireAdmin(await guard(form));
    const r = await deleteCategory(getPrisma(), str(form, "id"), actorOf(ctx));
    msg = r === "deleted" ? "Category deleted" : "Category hidden (removed items still refer to it)";
  } catch (e) { return back("/admin/shop", { e: safeMessage(e) }); }
  back("/admin/shop", { ok: msg });
}

export async function saveProductAction(form: FormData) {
  let msg = "";
  try {
    const ctx = requireAdmin(await guard(form));
    await saveProduct(getPrisma(), {
      id: str(form, "id") || undefined, categoryId: str(form, "categoryId"), name: str(form, "name"), description: str(form, "description"),
      imageUrl: await pictureFrom(form, "imageFile", "imageUrl", ctx), rankName: str(form, "rankName"), price: str(form, "price"), type: str(form, "type") || "ITEM", iconMaterial: str(form, "iconMaterial"),
      lore: str(form, "lore"), commands: str(form, "commands"), stockLimit: str(form, "stockLimit"), perPlayerLimit: str(form, "perPlayerLimit"),
      sortOrder: str(form, "sortOrder") || "0", enabled: form.get("enabled") === "on",
    }, actorOf(ctx));
    msg = "Item saved";
  } catch (e) { return back("/admin/shop", { e: safeMessage(e) }); }
  back("/admin/shop", { ok: msg });
}

export async function deleteProductAction(form: FormData) {
  let msg = "";
  try {
    const ctx = requireAdmin(await guard(form));
    await deleteProduct(getPrisma(), str(form, "id"), actorOf(ctx));
    msg = "Item removed from the shop";
  } catch (e) { return back("/admin/shop", { e: safeMessage(e) }); }
  back("/admin/shop", { ok: msg });
}

export async function saveAppearanceAction(form: FormData) {
  let msg = "";
  try {
    const ctx = requireAdmin(await guard(form));
    await setAppearance(getPrisma(), { siteName: str(form, "siteName"), logoUrl: await pictureFrom(form, "logoFile", "logoUrl", ctx), backgroundUrl: await pictureFrom(form, "backgroundFile", "backgroundUrl", ctx), defaultTheme: str(form, "defaultTheme") }, actorOf(ctx));
    revalidatePath("/", "layout");
    msg = "Appearance saved";
  } catch (e) { return back("/admin/appearance", { e: safeMessage(e) }); }
  back("/admin/appearance", { ok: msg });
}

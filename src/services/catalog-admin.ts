import type { Db } from "../lib/db.ts";
import { writeAudit } from "../lib/audit.ts";
import { AppError } from "../lib/errors.ts";
import { parseCommandLines, parseImageRef, parseLines } from "../lib/commands.ts";

type Actor = { actorUserId?: string | null; actorLabel?: string | null };
const TYPES = ["ITEM", "CRATE_KEY", "COSMETIC", "RANK", "PERMISSION", "COMMAND"] as const;
export type ProductTypeName = (typeof TYPES)[number];

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "item";
const MATERIAL = /^[A-Za-z0-9_:.]{1,64}$/;

async function uniqueSlug(db: Db, table: "category" | "product", base: string, ignoreId?: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const found = table === "category" ? await db.category.findUnique({ where: { slug } }) : await db.product.findUnique({ where: { slug } });
    if (!found || found.id === ignoreId) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function wholeNumber(v: unknown, what: string, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  if (!Number.isInteger(n) || n < min || n > max) throw new AppError("VALIDATION", `${what} must be a whole number from ${min} to ${max}`);
  return n;
}
function optionalWhole(v: unknown, what: string, min: number, max: number): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  return wholeNumber(v, what, min, max);
}

// ------------------------------------------------------------------ categories
export interface CategoryInput { id?: string; name: string; description?: string; iconMaterial?: string; sortOrder?: number | string; enabled?: boolean }

export async function saveCategory(db: Db, input: CategoryInput, actor: Actor) {
  const name = input.name.trim();
  if (!name || name.length > 64) throw new AppError("VALIDATION", "Category name must be 1 to 64 characters");
  const description = (input.description ?? "").trim();
  if (description.length > 255) throw new AppError("VALIDATION", "Description is too long (max 255)");
  const iconMaterial = (input.iconMaterial ?? "CHEST").trim().toUpperCase() || "CHEST";
  if (!MATERIAL.test(iconMaterial)) throw new AppError("VALIDATION", "Icon must be a Minecraft material name like CHEST or DIAMOND");
  const sortOrder = wholeNumber(input.sortOrder ?? 0, "Sort order", -10000, 10000);
  const data = { name, description: description || null, iconMaterial, sortOrder, enabled: input.enabled ?? true };
  return db.$transaction(async (tx) => {
    let id = input.id;
    if (id) {
      if (!(await tx.category.findUnique({ where: { id } }))) throw new AppError("NOT_FOUND", "Category not found");
      await tx.category.update({ where: { id }, data });
    } else {
      id = (await tx.category.create({ data: { ...data, slug: await uniqueSlug(tx as unknown as Db, "category", slugify(name)) } })).id;
    }
    await writeAudit(tx, { ...actor, action: input.id ? "category.update" : "category.create", targetType: "category", targetId: id, details: { name } });
    return id;
  });
}

/** Deletes a category that has no items. If removed items still reference it, it is hidden instead (history stays intact). */
export async function deleteCategory(db: Db, id: string, actor: Actor): Promise<"deleted" | "hidden"> {
  return db.$transaction(async (tx) => {
    const c = await tx.category.findUnique({ where: { id }, include: { products: { select: { deletedAt: true } } } });
    if (!c) throw new AppError("NOT_FOUND", "Category not found");
    if (c.products.some((p) => p.deletedAt === null)) throw new AppError("INVALID_STATE", "Remove or move the items in this category first");
    const result = c.products.length === 0 ? "deleted" : "hidden";
    if (result === "deleted") await tx.category.delete({ where: { id } });
    else await tx.category.update({ where: { id }, data: { enabled: false } });
    await writeAudit(tx, { ...actor, action: "category.delete", targetType: "category", targetId: id, details: { name: c.name, result } });
    return result;
  });
}

// ------------------------------------------------------------------ products
export interface ProductInput {
  id?: string;
  categoryId: string;
  name: string;
  description?: string;
  imageUrl?: string;
  rankName?: string;
  price: number | string;
  type?: string;
  iconMaterial?: string;
  lore?: string;          // one line per row, MiniMessage allowed
  commands?: string;      // one console command per row; {player} and {uuid} are replaced on delivery
  stockLimit?: number | string | null;
  perPlayerLimit?: number | string | null;
  sortOrder?: number | string;
  enabled?: boolean;
}

export async function saveProduct(db: Db, input: ProductInput, actor: Actor) {
  const name = input.name.trim();
  if (!name || name.length > 64) throw new AppError("VALIDATION", "Item name must be 1 to 64 characters");
  const description = (input.description ?? "").trim();
  if (description.length > 2000) throw new AppError("VALIDATION", "Description is too long (max 2000)");
  const price = wholeNumber(input.price, "Price", 0, 1_000_000_000);
  const type = (input.type ?? "ITEM").toUpperCase();
  if (!(TYPES as readonly string[]).includes(type)) throw new AppError("VALIDATION", "Unknown item type");
  const iconMaterial = (input.iconMaterial ?? "PAPER").trim().toUpperCase() || "PAPER";
  if (!MATERIAL.test(iconMaterial)) throw new AppError("VALIDATION", "Icon must be a Minecraft material name like DIAMOND");
  const lore = parseLines(input.lore ?? "", 12, 120, "lore");
  const commands = parseCommandLines(input.commands ?? "", "command");
  const stockLimit = optionalWhole(input.stockLimit, "Stock", 0, 1_000_000_000);
  const perPlayerLimit = optionalWhole(input.perPlayerLimit, "Per-player limit", 1, 1_000_000);
  const sortOrder = wholeNumber(input.sortOrder ?? 0, "Sort order", -10000, 10000);
  const imageUrl = parseImageRef(input.imageUrl ?? "", "Image link");
  const enabled = input.enabled ?? true;
  const rankName = (input.rankName ?? "").trim().toLowerCase() || null;
  let rankCommands = 0;
  if (rankName) {
    const rank = await db.rank.findUnique({ where: { name: rankName } });
    if (!rank) throw new AppError("VALIDATION", `There is no rank called "${rankName}". Create it first (Admin > Ranks or /tokens admin rank create)`);
    rankCommands = rank.grantCommands.length;
  }
  if (enabled && commands.length + rankCommands === 0) throw new AppError("VALIDATION", "An item needs at least one command to be for sale (what should the server do when it is bought? A rank item can use the rank's own grant command)");

  return db.$transaction(async (tx) => {
    if (!(await tx.category.findUnique({ where: { id: input.categoryId } }))) throw new AppError("NOT_FOUND", "Category not found");
    let id = input.id;
    const data = { categoryId: input.categoryId, name, description, imageUrl, price, type: type as ProductTypeName, iconMaterial, lore, commands, stockLimit, perPlayerLimit, sortOrder, enabled, rankName };
    if (id) {
      const existing = await tx.product.findUnique({ where: { id } });
      if (!existing || existing.deletedAt) throw new AppError("NOT_FOUND", "Item not found");
      if (stockLimit !== null && stockLimit < existing.stockSold) throw new AppError("VALIDATION", `Stock cannot be below the ${existing.stockSold} already sold`);
      await tx.product.update({ where: { id }, data });
    } else {
      if (stockLimit !== null && stockLimit < 0) throw new AppError("VALIDATION", "Stock cannot be negative");
      id = (await tx.product.create({ data: { ...data, slug: await uniqueSlug(tx as unknown as Db, "product", slugify(name)) } })).id;
    }
    await writeAudit(tx, { ...actor, action: input.id ? "product.update" : "product.create", targetType: "product", targetId: id, details: { name, price, enabled, commands: commands.length } });
    return id;
  });
}

/** Removes an item from sale. Past purchases keep their own copy of the name, price and commands. */
export async function deleteProduct(db: Db, id: string, actor: Actor): Promise<void> {
  await db.$transaction(async (tx) => {
    const p = await tx.product.findUnique({ where: { id } });
    if (!p || p.deletedAt) throw new AppError("NOT_FOUND", "Item not found");
    await tx.product.update({ where: { id }, data: { deletedAt: new Date(), enabled: false } });
    await writeAudit(tx, { ...actor, action: "product.delete", targetType: "product", targetId: id, details: { name: p.name } });
  });
}

export async function listShopForAdmin(db: Db) {
  return db.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { products: { where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
  });
}

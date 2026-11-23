import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, makeAccount, type TestDb } from "./helpers/db.ts";
import { catalog } from "../src/services/queries.ts";
import { deleteCategory, deleteProduct, listShopForAdmin, saveCategory, saveProduct } from "../src/services/catalog-admin.ts";
import { createPurchase } from "../src/services/purchases.ts";
import { adminAdjustTokens } from "../src/services/admin-tokens.ts";
import { parseCommandLines, parseHttpsUrl } from "../src/lib/commands.ts";
import { effectiveTheme, getAppearance, setAppearance, isAnimated } from "../src/services/appearance.ts";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t.close(); });
const actor = { actorLabel: "test-admin" };

describe("shop editor: categories and items", () => {
  it("creates, edits and removes a category and an item, and the public catalog follows", async () => {
    const catId = await saveCategory(t.prisma, { name: "Kits", description: "Starter kits", iconMaterial: "chest", sortOrder: 5 }, actor);
    const id = await saveProduct(t.prisma, {
      categoryId: catId, name: "Diamond Kit", description: "<gold>Shiny</gold>", price: "12", iconMaterial: "diamond",
      lore: "<gray>Five diamonds\n<green>Click to buy", commands: "/give {player} diamond 5\ntellraw {player} \"hi\"",
      stockLimit: "10", perPlayerLimit: "2", imageUrl: "https://img.example/kit.png", enabled: true,
    }, actor);
    let cat = (await catalog(t.prisma)).find((c) => c.id === catId)!;
    expect(cat.products).toHaveLength(1);
    expect(cat.products[0]).toMatchObject({ name: "Diamond Kit", price: 12, iconMaterial: "DIAMOND", imageUrl: "https://img.example/kit.png", stockRemaining: 10, perPlayerLimit: 2 });
    expect(cat.products[0]!.lore).toEqual(["<gray>Five diamonds", "<green>Click to buy"]);
    const stored = await t.prisma.product.findUnique({ where: { id } });
    expect(stored!.commands).toEqual(["give {player} diamond 5", "tellraw {player} \"hi\""]);   // leading "/" removed

    await saveProduct(t.prisma, { id, categoryId: catId, name: "Diamond Kit+", price: 15, commands: "give {player} diamond 8", enabled: true }, actor);
    cat = (await catalog(t.prisma)).find((c) => c.id === catId)!;
    expect(cat.products[0]).toMatchObject({ name: "Diamond Kit+", price: 15, stockRemaining: null });

    await saveProduct(t.prisma, { id, categoryId: catId, name: "Diamond Kit+", price: 15, commands: "give {player} diamond 8", enabled: false }, actor);
    expect((await catalog(t.prisma)).some((c) => c.id === catId)).toBe(false);   // hidden while disabled

    await expect(deleteCategory(t.prisma, catId, actor)).rejects.toMatchObject({ code: "INVALID_STATE" });   // still has an item
    await deleteProduct(t.prisma, id, actor);
    expect((await listShopForAdmin(t.prisma)).find((c) => c.id === catId)!.products).toHaveLength(0);
    expect(await deleteCategory(t.prisma, catId, actor)).toBe("hidden");   // the removed item still exists for history
    const audit = await t.prisma.adminAuditLog.findMany({ where: { actorLabel: "test-admin", action: { startsWith: "product." } } });
    expect(audit.map((a) => a.action).sort()).toEqual(["product.create", "product.delete", "product.update", "product.update"]);
  });

  it("deletes an empty category completely", async () => {
    const id = await saveCategory(t.prisma, { name: "Temp" }, actor);
    expect(await deleteCategory(t.prisma, id, actor)).toBe("deleted");
    expect(await t.prisma.category.findUnique({ where: { id } })).toBeNull();
  });

  it("rejects bad input: dangerous commands, insecure image links, negative prices, stock below sold, missing commands", async () => {
    const catId = await saveCategory(t.prisma, { name: "Validation" }, actor);
    const base = { categoryId: catId, name: "X", price: 1, commands: "say hi", enabled: true };
    await expect(saveProduct(t.prisma, { ...base, commands: "op {player}" }, actor)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveProduct(t.prisma, { ...base, commands: "say ok\n/STOP" }, actor)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveProduct(t.prisma, { ...base, imageUrl: "http://insecure.example/a.png" }, actor)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveProduct(t.prisma, { ...base, imageUrl: "https://x.example/a.png\" onerror=\"alert(1)" }, actor)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveProduct(t.prisma, { ...base, price: -5 }, actor)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveProduct(t.prisma, { ...base, price: 1.5 }, actor)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveProduct(t.prisma, { ...base, commands: "" }, actor)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveProduct(t.prisma, { ...base, type: "HACK" }, actor)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveProduct(t.prisma, { ...base, categoryId: "00000000-0000-4000-8000-000000000000" }, actor)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await t.prisma.product.count({ where: { categoryId: catId } })).toBe(0);
    // a draft (disabled) item may have no commands yet
    await saveProduct(t.prisma, { ...base, commands: "", enabled: false }, actor);
    // stock cannot drop below what has already been sold
    const id = await saveProduct(t.prisma, { ...base, name: "Limited", stockLimit: 5 }, actor);
    await t.prisma.product.update({ where: { id }, data: { stockSold: 3 } });
    await expect(saveProduct(t.prisma, { id, ...base, name: "Limited", stockLimit: 2 }, actor)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("an item removed or edited after a purchase does not change what that buyer paid for", async () => {
    const catId = await saveCategory(t.prisma, { name: "History" }, actor);
    const id = await saveProduct(t.prisma, { categoryId: catId, name: "Old name", price: 4, commands: "give {player} apple 1", enabled: true }, actor);
    const a = await makeAccount(t.prisma);
    await adminAdjustTokens(t.prisma, { mcAccountId: a.id, action: "give", amount: 50, idempotencyKey: "seed-" + a.id, actorLabel: "t", reason: "t" });
    const r = await createPurchase(t.prisma, { mcAccountId: a.id, productId: id, source: "WEB", idempotencyKey: "buy-" + a.id });
    await saveProduct(t.prisma, { id, categoryId: catId, name: "New name", price: 99, commands: "say changed", enabled: true }, actor);
    await deleteProduct(t.prisma, id, actor);
    const p = await t.prisma.purchase.findUnique({ where: { id: r.purchase.id } });
    expect(p).toMatchObject({ productName: "Old name", unitPrice: 4 });
    const rw = await t.prisma.rewardQueue.findFirst({ where: { purchaseId: r.purchase.id } });
    expect(rw!.commands).toEqual(["give {player} apple 1"]);
    await expect(createPurchase(t.prisma, { mcAccountId: a.id, productId: id, source: "WEB", idempotencyKey: "buy2-" + a.id })).rejects.toBeTruthy();
  });
});

describe("validators", () => {
  it("parseCommandLines / parseHttpsUrl", () => {
    expect(parseCommandLines("  /say a \n\n lp user {player} parent add vip ")).toEqual(["say a", "lp user {player} parent add vip"]);
    expect(() => parseCommandLines("a\u0007b")).toThrow();
    expect(() => parseCommandLines("x".repeat(300))).toThrow();
    expect(parseHttpsUrl("", "x")).toBeNull();
    expect(parseHttpsUrl(" https://a.example/b.png ", "x")).toBe("https://a.example/b.png");
    expect(() => parseHttpsUrl("javascript:alert(1)", "x")).toThrow();
    expect(() => parseHttpsUrl("//a.example/x.png", "x")).toThrow();
  });
});

describe("appearance and themes", () => {
  it("stores and validates appearance, and only admins ever get an animated theme", async () => {
    expect(await getAppearance(t.prisma)).toMatchObject({ siteName: "TokenStore", defaultTheme: "dark", logoUrl: null });
    await setAppearance(t.prisma, { siteName: "ABMC Store", logoUrl: "https://i.example/logo.png", backgroundUrl: "", defaultTheme: "ocean" }, actor);
    expect(await getAppearance(t.prisma)).toEqual({ siteName: "ABMC Store", logoUrl: "https://i.example/logo.png", backgroundUrl: null, defaultTheme: "ocean" });
    await expect(setAppearance(t.prisma, { siteName: "", logoUrl: null, backgroundUrl: null, defaultTheme: "ocean" }, actor)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(setAppearance(t.prisma, { siteName: "x", logoUrl: "http://no", backgroundUrl: null, defaultTheme: "ocean" }, actor)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(setAppearance(t.prisma, { siteName: "x", logoUrl: null, backgroundUrl: null, defaultTheme: "evil" }, actor)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(isAnimated("aurora")).toBe(true);
    expect(effectiveTheme("light", "ocean", false)).toBe("light");
    expect(effectiveTheme("aurora", "ocean", false)).toBe("ocean");   // a player editing the cookie gets nothing
    expect(effectiveTheme("aurora", "ocean", true)).toBe("aurora");
    expect(effectiveTheme("nonsense", "ocean", true)).toBe("ocean");
    expect(effectiveTheme(undefined, "aurora", false)).toBe("aurora");   // an admin-set animated site default is shown to everyone
  });
});

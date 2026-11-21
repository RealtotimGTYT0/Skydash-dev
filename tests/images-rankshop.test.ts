import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, key, makeAccount, makeCategory, type TestDb } from "./helpers/db.ts";
import { getImage, saveImage, sniffImage, MAX_IMAGE_BYTES } from "../src/services/images.ts";
import { parseImageRef } from "../src/lib/commands.ts";
import { createRank, ranksOf, setRankCommands } from "../src/services/ranks.ts";
import { saveProduct } from "../src/services/catalog-admin.ts";
import { cancelPurchase, createPurchase } from "../src/services/purchases.ts";
import { catalog } from "../src/services/queries.ts";
import { getBalance } from "../src/services/tokens.ts";

let t: TestDb;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t.close(); });
const actor = { actorLabel: "web:Boss" };
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("uploaded pictures", () => {
  it("accepts real PNG/JPEG/GIF/WebP bytes and refuses everything else (SVG, HTML, empty, huge)", async () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(new TextEncoder().encode("GIF89a.."))).toBe("image/gif");
    expect(sniffImage(new TextEncoder().encode("RIFFxxxxWEBPVP8 "))).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<html>"))).toBeNull();
    await expect(saveImage(t.prisma, new Uint8Array(), "x")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveImage(t.prisma, new TextEncoder().encode("<svg/>"), "x")).rejects.toMatchObject({ code: "VALIDATION" });
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1); big.set(PNG);
    await expect(saveImage(t.prisma, big, "x")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("stores a picture, serves it back by id, and the saved path is a valid picture reference", async () => {
    const path = await saveImage(t.prisma, PNG, "web:Boss");
    expect(path).toMatch(/^\/img\/[0-9a-f-]{36}$/);
    expect(parseImageRef(path, "x")).toBe(path);
    const got = await getImage(t.prisma, path.slice("/img/".length));
    expect(got?.mime).toBe("image/png");
    expect(Buffer.from(got!.data).equals(Buffer.from(PNG))).toBe(true);
    expect(await getImage(t.prisma, "not-a-uuid")).toBeNull();
    expect(await getImage(t.prisma, "00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(() => parseImageRef("/img/../../etc/passwd", "x")).toThrow();
    expect(() => parseImageRef("http://insecure.example/a.png", "x")).toThrow();
  });
});

describe("rank items in the shop", () => {
  it("a rank item needs an existing rank, sells once per player, adds the rank's grant command, and a cancel takes the rank back", async () => {
    const cat = await makeCategory(t.prisma);
    const base = { categoryId: cat.id, name: "VIP rank", price: "20", type: "RANK", commands: "", enabled: true };
    await expect(saveProduct(t.prisma, { ...base, rankName: "vip" }, actor)).rejects.toMatchObject({ code: "VALIDATION" });   // no such rank
    await createRank(t.prisma, { name: "vip", displayName: "VIP" }, actor);
    await expect(saveProduct(t.prisma, { ...base, rankName: "vip" }, actor)).rejects.toMatchObject({ code: "VALIDATION" });   // rank has no command yet, item has none
    await setRankCommands(t.prisma, { name: "vip", kind: "grant", commands: ["lp user {player} parent add vip"] }, actor);
    const id = await saveProduct(t.prisma, { ...base, rankName: "vip", commands: "broadcast {player} bought VIP" }, actor);

    expect((await catalog(t.prisma)).flatMap((c) => c.products).find((p) => p.id === id)?.rankName).toBe("vip");

    const a = await makeAccount(t.prisma, { balance: 50 });
    const r = await createPurchase(t.prisma, { mcAccountId: a.id, productId: id, source: "WEB", idempotencyKey: key("rank") });
    expect(r.reward?.commands).toEqual(["broadcast {player} bought VIP", "lp user {player} parent add vip"]);
    expect((await ranksOf(t.prisma, a.id)).map((x) => x.name)).toEqual(["vip"]);
    expect(await getBalance(t.prisma, a.id)).toBe(30);

    // second purchase refused, nothing charged, no stock taken
    await expect(createPurchase(t.prisma, { mcAccountId: a.id, productId: id, source: "WEB", idempotencyKey: key("rank") })).rejects.toMatchObject({ code: "LIMIT_REACHED" });
    expect(await getBalance(t.prisma, a.id)).toBe(30);
    expect((await t.prisma.product.findUniqueOrThrow({ where: { id } })).stockSold).toBe(1);

    await cancelPurchase(t.prisma, { purchaseId: r.purchase.id, actorLabel: "test" });
    expect(await ranksOf(t.prisma, a.id)).toEqual([]);
    expect(await getBalance(t.prisma, a.id)).toBe(50);
  });
});

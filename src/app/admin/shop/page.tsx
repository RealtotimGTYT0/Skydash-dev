import { notFound, redirect } from "next/navigation";
import { getPrisma } from "../../../lib/db.ts";
import { csrfToken, currentAuth } from "../../../web/session.ts";
import { listShopForAdmin } from "../../../services/catalog-admin.ts";
import { deleteCategoryAction, deleteProductAction, saveCategoryAction, saveProductAction } from "../../actions.ts";
import { AdminNav } from "../AdminNav.tsx";
import { Notice } from "../../Notice.tsx";
import { Rich } from "../../Rich.tsx";

const TYPES = ["ITEM", "CRATE_KEY", "COSMETIC", "RANK", "PERMISSION", "COMMAND"];

type Cat = Awaited<ReturnType<typeof listShopForAdmin>>[number];
type Prod = Cat["products"][number];

function ProductForm({ csrf, categoryId, p }: { csrf: string; categoryId: string; p?: Prod }) {
  return (
    <form action={saveProductAction} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="_csrf" value={csrf} /><input type="hidden" name="id" value={p?.id ?? ""} /><input type="hidden" name="categoryId" value={categoryId} />
      <div><label className="label">Name (colors allowed, like &lt;gold&gt;Kit)</label><input name="name" defaultValue={p?.name ?? ""} className="input" required maxLength={64} /></div>
      <div><label className="label">Price (tokens)</label><input name="price" type="number" min="0" defaultValue={p?.price ?? 1} className="input" required /></div>
      <div className="sm:col-span-2"><label className="label">Description</label><textarea name="description" rows={2} defaultValue={p?.description ?? ""} className="input" maxLength={2000} /></div>
      <div><label className="label">In-game icon (Minecraft material)</label><input name="iconMaterial" defaultValue={p?.iconMaterial ?? "PAPER"} className="input" placeholder="DIAMOND" /></div>
      <div><label className="label">Type</label><select name="type" defaultValue={p?.type ?? "ITEM"} className="input">{TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
      <div className="sm:col-span-2"><label className="label">Picture for the website: upload a file (PNG, JPG, GIF, WebP, up to 1.5 MB) or paste a link</label>
        {p?.imageUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={p.imageUrl} alt="" className="mb-2 h-16 w-16 rounded object-cover" />}
        <input name="imageFile" type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="input" />
        <input name="imageUrl" defaultValue={p?.imageUrl ?? ""} className="input mt-2" placeholder="https://i.imgur.com/example.png (empty = no picture)" /></div>
      <div className="sm:col-span-2"><label className="label">Rank given when bought (optional, the rank id like vip; set Type to RANK)</label><input name="rankName" defaultValue={p?.rankName ?? ""} className="input" placeholder="vip" maxLength={32} /></div>
      <div className="sm:col-span-2"><label className="label">In-game description lines (one per line, colors allowed)</label><textarea name="lore" rows={3} defaultValue={(p?.lore ?? []).join("\n")} className="input font-mono" /></div>
      <div className="sm:col-span-2"><label className="label">What the server runs when it is bought (one command per line, no slash). Use {"{player}"} for the buyer.</label>
        <textarea name="commands" rows={3} defaultValue={(p?.commands ?? []).join("\n")} className="input font-mono" placeholder="give {player} diamond 5" /></div>
      <div><label className="label">Stock (empty = unlimited)</label><input name="stockLimit" type="number" min="0" defaultValue={p?.stockLimit ?? ""} className="input" /></div>
      <div><label className="label">Max per player (empty = unlimited)</label><input name="perPlayerLimit" type="number" min="1" defaultValue={p?.perPlayerLimit ?? ""} className="input" /></div>
      <div><label className="label">Sort order (small first)</label><input name="sortOrder" type="number" defaultValue={p?.sortOrder ?? 0} className="input" /></div>
      <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="enabled" defaultChecked={p?.enabled ?? true} /> For sale</label>
      <div className="sm:col-span-2"><button className="btn">{p ? "Save item" : "Add item"}</button></div>
    </form>
  );
}

export default async function AdminShop({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const auth = await currentAuth();
  if (!auth) redirect("/login");
  if (auth.user.role !== "ADMIN" || auth.user.status !== "ACTIVE") notFound();
  const { e, ok } = await searchParams;
  const csrf = await csrfToken();
  const cats = await listShopForAdmin(getPrisma());
  const hidden = <input type="hidden" name="_csrf" value={csrf} />;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin</h1>
      <AdminNav current="shop" />
      <Notice error={e} ok={ok} />
      <section className="card">
        <h2 className="mb-3 font-semibold">Add a category</h2>
        <form action={saveCategoryAction} className="flex flex-wrap items-end gap-3">{hidden}
          <div><label className="label">Name</label><input name="name" className="input w-48" required maxLength={64} /></div>
          <div><label className="label">Icon</label><input name="iconMaterial" defaultValue="CHEST" className="input w-36" /></div>
          <div><label className="label">Description</label><input name="description" className="input w-64" maxLength={255} /></div>
          <input type="hidden" name="enabled" value="on" /><button className="btn">Add category</button>
        </form>
      </section>
      {cats.length === 0 && <p className="text-sm text-zinc-400">No categories yet. Add one above, then add items to it.</p>}
      {cats.map((c) => (
        <section key={c.id} className="card space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="font-semibold"><Rich text={c.name} /> {!c.enabled && <span className="text-xs text-zinc-500">(hidden)</span>}</h2>
              <p className="text-xs text-zinc-500">{c.products.length} item(s)</p></div>
            <form action={deleteCategoryAction}>{hidden}<input type="hidden" name="id" value={c.id} />
              <button className="btn-danger" title="Only possible when the category has no items">Delete category</button></form>
          </div>
          <details><summary className="cursor-pointer text-sm text-zinc-400">Edit category</summary>
            <form action={saveCategoryAction} className="mt-3 flex flex-wrap items-end gap-3">{hidden}<input type="hidden" name="id" value={c.id} />
              <div><label className="label">Name</label><input name="name" defaultValue={c.name} className="input w-48" required /></div>
              <div><label className="label">Icon</label><input name="iconMaterial" defaultValue={c.iconMaterial} className="input w-36" /></div>
              <div><label className="label">Description</label><input name="description" defaultValue={c.description ?? ""} className="input w-64" /></div>
              <div><label className="label">Sort</label><input name="sortOrder" type="number" defaultValue={c.sortOrder} className="input w-24" /></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={c.enabled} /> Visible</label>
              <button className="btn">Save category</button></form></details>
          <div className="space-y-2">
            {c.products.map((p) => (
              <details key={p.id} className="rounded-lg border border-zinc-800 p-3">
                <summary className="cursor-pointer text-sm"><Rich text={p.name} /> <span className="text-amber-400">{p.price} tokens</span>
                  {!p.enabled && <span className="ml-2 text-xs text-zinc-500">(not for sale)</span>}
                  {p.stockLimit !== null && <span className="ml-2 text-xs text-zinc-500">stock {p.stockLimit - p.stockSold}/{p.stockLimit}</span>}</summary>
                <div className="mt-3 space-y-3"><ProductForm csrf={csrf} categoryId={c.id} p={p} />
                  <form action={deleteProductAction}>{hidden}<input type="hidden" name="id" value={p.id} /><button className="btn-danger">Remove this item</button></form></div>
              </details>))}
            <details className="rounded-lg border border-dashed border-zinc-700 p-3"><summary className="cursor-pointer text-sm text-amber-400">+ Add an item to this category</summary>
              <div className="mt-3"><ProductForm csrf={csrf} categoryId={c.id} /></div></details>
          </div>
        </section>))}
    </div>
  );
}

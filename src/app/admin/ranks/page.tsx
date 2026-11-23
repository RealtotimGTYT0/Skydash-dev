import { notFound, redirect } from "next/navigation";
import { getPrisma } from "../../../lib/db.ts";
import { csrfToken, currentAuth } from "../../../web/session.ts";
import { listRanks } from "../../../services/ranks.ts";
import { deleteRankAction, saveRankAction } from "../../actions.ts";
import { AdminNav } from "../AdminNav.tsx";
import { Notice } from "../../Notice.tsx";
import { Rich } from "../../Rich.tsx";

type R = Awaited<ReturnType<typeof listRanks>>[number];

function RankForm({ csrf, r }: { csrf: string; r?: R }) {
  return (
    <form action={saveRankAction} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="_csrf" value={csrf} /><input type="hidden" name="isNew" value={r ? "0" : "1"} />
      <div><label className="label">Id (small letters, e.g. vip)</label><input name="name" defaultValue={r?.name ?? ""} readOnly={Boolean(r)} className="input font-mono" required maxLength={32} pattern="[a-z0-9_\-]{1,32}" /></div>
      <div><label className="label">Priority (higher shows first)</label><input name="priority" type="number" min="-1000" max="1000" defaultValue={r?.priority ?? 0} className="input" /></div>
      <div className="sm:col-span-2"><label className="label">How it looks. Colors: &lt;red&gt;[Mod]  Gradient: &lt;gradient:#ff0000:#0000ff&gt;[Dev]  Rainbow: &lt;rainbow&gt;[Owner]  also &lt;bold&gt;, and the old &amp;6 codes</label>
        <input name="displayName" defaultValue={r?.displayName ?? ""} className="input font-mono" maxLength={120} placeholder="<gold>[VIP]" /></div>
      <div><label className="label">LuckPerms group (empty = not linked)</label><input name="lpGroup" defaultValue={r?.lpGroup ?? ""} className="input font-mono" maxLength={64} placeholder="vip" /></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="animated" defaultChecked={r?.animated} /> Animated colours</label>
      <div className="sm:col-span-2"><button className="btn">{r ? "Save rank" : "Create rank"}</button></div>
    </form>
  );
}

export default async function AdminRanks({ searchParams }: { searchParams: Promise<{ ok?: string; e?: string }> }) {
  const auth = await currentAuth();
  if (!auth) redirect("/login");
  if (auth.user.role !== "ADMIN" || auth.user.status !== "ACTIVE") notFound();
  const sp = await searchParams;
  const csrf = await csrfToken();
  const ranks = await listRanks(getPrisma());
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin</h1>
      <AdminNav current="ranks" />
      <Notice ok={sp.ok} error={sp.e} />
      <section className="card space-y-3">
        <h2 className="font-semibold">New rank</h2>
        <RankForm csrf={csrf} />
      </section>
      <section className="card space-y-3">
        <h2 className="font-semibold">Ranks</h2>
        {ranks.length === 0 ? <p className="text-sm text-zinc-400">No ranks yet.</p> : ranks.map((r) => (
          <details key={r.name} className="rounded-lg border border-zinc-800 p-3">
            <summary className="cursor-pointer"><span className="mr-3 font-mono">{r.name}</span><Rich text={r.displayName} animated={r.animated} />
              <span className="ml-3 text-xs text-zinc-500">priority {r.priority} · {r.holders} player(s){r.lpGroup ? ` · LuckPerms: ${r.lpGroup}` : ""}{r.animated ? " · animated" : ""}</span></summary>
            <div className="mt-3 space-y-3">
              <RankForm csrf={csrf} r={r} />
              <div className="font-mono text-xs text-zinc-400">
                {r.lpGroup && <div>on give: lp user {"{uuid}"} parent add {r.lpGroup}</div>}
                {r.grantCommands.length > 0 && <div>on give: {r.grantCommands.join(" ; ")}</div>}
                {r.lpGroup && <div>on remove: lp user {"{uuid}"} parent remove {r.lpGroup}</div>}
                {r.revokeCommands.length > 0 && <div>on remove: {r.revokeCommands.join(" ; ")}</div>}
              </div>
              <form action={deleteRankAction}><input type="hidden" name="_csrf" value={csrf} /><input type="hidden" name="name" value={r.name} />
                <button className="btn-danger">Delete this rank</button></form>
            </div>
          </details>))}
        <div className="rounded-lg bg-zinc-950 p-3 font-mono text-xs text-zinc-400">
          In the game: /tokens admin rank lp vip vip (link to LuckPerms group) · rank animate vip on · rank give vip Steve · rank remove vip Steve · rank list
        </div>
      </section>
    </div>
  );
}

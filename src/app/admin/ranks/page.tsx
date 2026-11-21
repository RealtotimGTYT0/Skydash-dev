import { notFound, redirect } from "next/navigation";
import { getPrisma } from "../../../lib/db.ts";
import { csrfToken, currentAuth } from "../../../web/session.ts";
import { listRanks } from "../../../services/ranks.ts";
import { saveRankAction } from "../../actions.ts";
import { AdminNav } from "../AdminNav.tsx";
import { Notice } from "../../Notice.tsx";
import { Rich } from "../../Rich.tsx";

function RankForm({ csrf, r }: { csrf: string; r?: { name: string; displayName: string; priority: number; grantCommands: string[]; revokeCommands: string[] } }) {
  return (
    <form action={saveRankAction} className="space-y-2">
      <input type="hidden" name="_csrf" value={csrf} />
      {!r && <input type="hidden" name="isNew" value="1" />}
      <div className="grid gap-2 sm:grid-cols-3">
        <div><label className="label">Id</label><input name="name" defaultValue={r?.name ?? ""} className="input font-mono" required maxLength={32} readOnly={Boolean(r)} placeholder="vip" /></div>
        <div><label className="label">Shown as (colors allowed)</label><input name="displayName" defaultValue={r?.displayName ?? ""} className="input" maxLength={120} placeholder="<gold>VIP" /></div>
        <div><label className="label">Priority</label><input name="priority" type="number" defaultValue={r?.priority ?? 0} className="input" /></div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div><label className="label">Commands when the rank is given (one per line, {"{player}"} = name)</label>
          <textarea name="grantCommands" defaultValue={r?.grantCommands.join("\n") ?? ""} className="input font-mono text-xs" rows={4} placeholder={"lp user {player} parent add vip\neco give {player} 500"} /></div>
        <div><label className="label">Commands when the rank is removed (one per line)</label>
          <textarea name="revokeCommands" defaultValue={r?.revokeCommands.join("\n") ?? ""} className="input font-mono text-xs" rows={4} placeholder="lp user {player} parent remove vip" /></div>
      </div>
      <button className="btn">{r ? "Save rank" : "Create rank"}</button>
    </form>
  );
}

export default async function AdminRanks({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const auth = await currentAuth();
  if (!auth) redirect("/login");
  if (auth.user.role !== "ADMIN" || auth.user.status !== "ACTIVE") notFound();
  const { e, ok } = await searchParams;
  const ranks = await listRanks(getPrisma());
  const csrf = await csrfToken();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin</h1>
      <AdminNav current="ranks" />
      <Notice error={e} ok={ok} />
      <section className="card space-y-3">
        <h2 className="font-semibold">New rank</h2>
        <RankForm csrf={csrf} />
      </section>
      {ranks.map((r) => (
        <section key={r.name} className="card space-y-2">
          <h2 className="font-semibold"><Rich text={r.displayName} /> <span className="font-mono text-xs text-zinc-500">{r.name} · {r.holders} player(s)</span></h2>
          <RankForm csrf={csrf} r={r} />
        </section>))}
      <p className="text-xs text-zinc-500">In game: <span className="font-mono">/tokens admin rank give|remove [player] [rank]</span>, <span className="font-mono">rank addcmd [rank] [grant|revoke] [command]</span> adds one more command. Commands on the plugin's blocked list (config.yml) are skipped.</p>
    </div>
  );
}

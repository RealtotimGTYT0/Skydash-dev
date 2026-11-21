import { notFound, redirect } from "next/navigation";
import { getPrisma } from "../../../lib/db.ts";
import { currentAuth } from "../../../web/session.ts";
import { listRanks } from "../../../services/ranks.ts";
import { AdminNav } from "../AdminNav.tsx";
import { Rich } from "../../Rich.tsx";

export default async function AdminRanks() {
  const auth = await currentAuth();
  if (!auth) redirect("/login");
  if (auth.user.role !== "ADMIN" || auth.user.status !== "ACTIVE") notFound();
  const ranks = await listRanks(getPrisma());
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin</h1>
      <AdminNav current="ranks" />
      <section className="card space-y-3">
        <h2 className="font-semibold">Ranks</h2>
        {ranks.length === 0 ? <p className="text-sm text-zinc-400">No ranks yet. Create them in the game (see below).</p> : (
          <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-zinc-500"><tr><th>Id</th><th>Shown as</th><th>Priority</th><th>Players</th><th>Commands</th></tr></thead>
            <tbody>{ranks.map((r) => (
              <tr key={r.name} className="border-t border-zinc-800 align-top"><td className="py-2 font-mono">{r.name}</td><td><Rich text={r.displayName} /></td><td>{r.priority}</td><td>{r.holders}</td>
                <td className="font-mono text-xs text-zinc-400">{r.grantCommands.length > 0 && <div>on give: {r.grantCommands.join(" ; ")}</div>}{r.revokeCommands.length > 0 && <div>on remove: {r.revokeCommands.join(" ; ")}</div>}</td></tr>))}</tbody></table>)}
        <div className="rounded-lg bg-zinc-950 p-3 font-mono text-xs text-zinc-400">
          /tokens admin rank create vip &lt;gold&gt;VIP<br />
          /tokens admin rank setcmd vip grant lp user {"{player}"} parent add vip<br />
          /tokens admin rank give Steve vip<br />
          /tokens admin rank remove Steve vip<br />
          /tokens admin rank list
        </div>
      </section>
    </div>
  );
}

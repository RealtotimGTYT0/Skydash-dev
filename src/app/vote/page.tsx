import { getPrisma } from "../../lib/db.ts";
import { getVoteConfig, listVoteSites } from "../../services/votes.ts";

export default async function Vote() {
  const db = getPrisma();
  const [cfg, sites] = await Promise.all([getVoteConfig(db), listVoteSites(db)]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Vote for the server</h1>
      <p className="text-zinc-400">{cfg.tokens > 0 ? `Vote on each site below and get ${cfg.tokens} token(s) per site, once every ${cfg.cooldownHours} hours.` : "Voting helps the server grow."} Use your exact Minecraft name when you vote. Tokens arrive automatically, even if you are offline.</p>
      {sites.length === 0 ? <p className="text-zinc-400">No vote sites have been added yet.</p> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {sites.map((s) => (
            <a key={s.serviceName} href={s.url} target="_blank" rel="noopener noreferrer" className="card block hover:border-amber-500">
              <span className="font-semibold text-zinc-100">{s.serviceName}</span><span className="block text-sm text-zinc-500">Open vote page</span>
            </a>))}
        </div>)}
    </div>
  );
}

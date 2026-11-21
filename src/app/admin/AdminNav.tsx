import Link from "next/link";

export function AdminNav({ current }: { current: "overview" | "shop" | "appearance" | "ranks" }) {
  const item = (href: string, key: string, label: string) => (
    <Link href={href} className={`rounded-lg px-3 py-1 text-sm ${current === key ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900"}`}>{label}</Link>
  );
  return <div className="mb-6 flex flex-wrap gap-2">{item("/admin", "overview", "Overview")}{item("/admin/shop", "shop", "Shop items")}{item("/admin/ranks", "ranks", "Ranks")}{item("/admin/appearance", "appearance", "Appearance")}</div>;
}

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, company_name, full_name")
    .eq("id", user.id)
    .single();

  const isAdmin = profile?.role === "admin";
  const nav = isAdmin
    ? [
        { href: "/app/admin", label: "Bid requests" },
        { href: "/app/admin/contractors", label: "Contractors" },
        { href: "/app/admin/trades", label: "Trades" },
      ]
    : [
        { href: "/app", label: "Bids" },
        { href: "/app/network", label: "Network" },
        { href: "/app/settings", label: "Settings" },
      ];

  return (
    <div className="min-h-screen bg-bw-surface">
      <AppHeader nav={nav} badge={isAdmin ? "Operator console" : profile?.company_name ?? undefined} />
      <main className="max-w-[1100px] mx-auto px-6 py-8">{children}</main>
    </div>
  );
}

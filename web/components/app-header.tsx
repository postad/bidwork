"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";

type NavItem = { href: string; label: string };

export function AppHeader({ nav, badge }: { nav: NavItem[]; badge?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-bw-border">
      <div className="max-w-[1100px] mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Logo href="/app" tag={badge} />
          <nav className="hidden sm:flex items-center gap-1">
            {nav.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 rounded-lg text-[13px] font-medium ${
                    active ? "bg-bw-green-tint text-bw-text" : "text-bw-body hover:bg-bw-surface"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <button onClick={signOut} className="text-[13px] font-medium text-bw-body hover:text-bw-text">
          Sign out
        </button>
      </div>
    </header>
  );
}

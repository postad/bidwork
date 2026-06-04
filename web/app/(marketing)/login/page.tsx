"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next");
    router.push(next || "/app");
    router.refresh();
  }

  const field =
    "w-full rounded-lg border border-bw-border px-3 py-2 text-[14px] outline-none focus:border-bw-green focus:ring-2 focus:ring-bw-green-tint";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-bw-surface px-6">
      <div className="mb-6">
        <Logo />
      </div>
      <Card className="w-full max-w-[400px] p-6">
        <h1 className="text-[20px] font-extrabold tracking-tight mb-1">Welcome back</h1>
        <p className="text-[13px] text-bw-body mb-5">Sign in to your BidWork workspace.</p>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="text-[12px] font-semibold text-bw-body">Email</label>
            <input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-bw-body">Password</label>
            <input className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </div>
          {error ? <p className="text-[13px] text-bw-red">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <p className="text-[13px] text-bw-body mt-4 text-center">
          New here? <Link href="/signup" className="font-semibold text-bw-green hover:text-bw-green-hover">Create a workspace</Link>
        </p>
      </Card>
    </div>
  );
}

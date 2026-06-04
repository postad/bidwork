"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { signUpContractor } from "./actions";

export default function SignupPage() {
  const router = useRouter();
  const supabase = createClient();
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // 1. Server creates the (pre-confirmed) user + workspace + profile atomically.
      await signUpContractor(email, password, company);
      // 2. Browser signs in to establish its session, then on to the picker.
      const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signErr) throw signErr;
      router.push("/app/onboarding/trades");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }

  const field = "w-full rounded-lg border border-bw-border px-3 py-2 text-[14px] outline-none focus:border-bw-green focus:ring-2 focus:ring-bw-green-tint";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-bw-surface px-6">
      <div className="mb-6">
        <Logo />
      </div>
      <Card className="w-full max-w-[400px] p-6">
        <h1 className="text-[20px] font-extrabold tracking-tight mb-1">Create your workspace</h1>
        <p className="text-[13px] text-bw-body mb-5">Start auto-bidding in minutes — pick your trades, upload a few past proposals, done.</p>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="text-[12px] font-semibold text-bw-body">Company name</label>
            <input className={field} value={company} onChange={(e) => setCompany(e.target.value)} required autoComplete="organization" />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-bw-body">Email</label>
            <input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-bw-body">Password</label>
            <input className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
          </div>
          {error ? <p className="text-[13px] text-bw-red">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating…" : "Create account"}
          </Button>
        </form>
        <p className="text-[13px] text-bw-body mt-4 text-center">
          Already have an account? <Link href="/login" className="font-semibold text-bw-green hover:text-bw-green-hover">Sign in</Link>
        </p>
      </Card>
    </div>
  );
}

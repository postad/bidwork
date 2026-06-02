"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createBidRequest, finalizeBidRequest } from "./actions";

export default function UploadPage() {
  const router = useRouter();
  const supabase = createClient();
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [zip, setZip] = useState("10018");
  const [radius, setRadius] = useState(100);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const field = "w-full rounded-lg border border-bw-border px-3 py-2 text-[14px] outline-none focus:border-bw-green focus:ring-2 focus:ring-bw-green-tint";

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    setFiles(picked);
    if (!title && picked[0]) setTitle(picked[0].name.replace(/\.pdf$/i, ""));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!files.length) return;
    setBusy(true);
    setError(null);
    try {
      setStatus("Preparing upload…");
      const { bidRequestId, uploads } = await createBidRequest({ title, zip, radius, files: files.map((f) => ({ name: f.name })) });

      for (let i = 0; i < files.length; i++) {
        setStatus(`Uploading ${i + 1}/${files.length}: ${files[i].name}`);
        const u = uploads[i];
        const { error } = await supabase.storage.from("bid-docs").uploadToSignedUrl(u.path, u.token, files[i]);
        if (error) throw error;
      }

      setStatus("Starting trade scan…");
      await finalizeBidRequest(bidRequestId, files.map((f, i) => ({ name: f.name, path: uploads[i].path, size: f.size })));
      router.push("/app/admin");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
      setStatus(null);
    }
  }

  return (
    <div className="max-w-[640px]">
      <h1 className="text-[1.6rem] font-extrabold tracking-tight mb-1">New bid request</h1>
      <p className="text-[14px] text-bw-body mb-6">
        Upload the package once. The system reads it and scores every trade, then dispatches to matching contractors.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <Card className="p-5">
          <div className="font-semibold mb-2">1 · The documents</div>
          <input type="file" accept="application/pdf" multiple onChange={onPick} className="block w-full text-[13px]" />
          {files.length > 0 && (
            <ul className="mt-3 space-y-1 text-[13px] text-bw-body">
              {files.map((f) => (
                <li key={f.name} className="flex justify-between">
                  <span>{f.name}</span>
                  <span className="font-mono text-bw-muted">{(f.size / 1048576).toFixed(1)} MB</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5 space-y-4">
          <div className="font-semibold">2 · The area</div>
          <div>
            <label className="text-[12px] font-semibold text-bw-body">Request title</label>
            <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[12px] font-semibold text-bw-body">Center ZIP</label>
              <input className={field} value={zip} onChange={(e) => setZip(e.target.value)} required />
            </div>
            <div>
              <label className="text-[12px] font-semibold text-bw-body">Radius: {radius} mi</label>
              <input type="range" min={10} max={250} step={5} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="w-full mt-2 accent-bw-green" />
            </div>
          </div>
          <p className="text-[12px] text-bw-muted">~$1.50 / package · scans all trades in one read, extracts only the bid trades.</p>
        </Card>

        {error && <p className="text-[13px] text-bw-red">{error}</p>}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy || !files.length}>
            {busy ? "Working…" : "Upload & analyze"}
          </Button>
          {status && <span className="text-[13px] text-bw-body">{status}</span>}
        </div>
      </form>
    </div>
  );
}

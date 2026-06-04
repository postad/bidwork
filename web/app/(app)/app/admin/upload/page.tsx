"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createZipUpload, finalizeZipUpload } from "./actions";

export default function UploadPage() {
  const router = useRouter();
  const supabase = createClient();
  const [files, setFiles] = useState<File[]>([]);
  const [zip, setZip] = useState("10018");
  const [radius, setRadius] = useState(100);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const field = "w-full rounded-lg border border-bw-border px-3 py-2 text-[14px] outline-none focus:border-bw-green focus:ring-2 focus:ring-bw-green-tint";

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(e.target.files ?? []));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!files.length) return;
    setBusy(true);
    setError(null);
    try {
      // One zip = one project. Upload each sequentially (parallel just saturates
      // upstream) and fire its ingest the moment its bytes land — so the batch isn't
      // gated by the slowest zip; project #1 scans while #4 is still uploading.
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const title = file.name.replace(/\.(zip|pdf)$/i, "");
        setStatus(`Uploading ${i + 1}/${files.length}: ${file.name}`);
        const { bidRequestId, path, token } = await createZipUpload({ title, zip, radius, fileName: file.name });
        const { error: upErr } = await supabase.storage.from("bid-docs").uploadToSignedUrl(path, token, file);
        if (upErr) throw upErr;
        await finalizeZipUpload(bidRequestId, path);
      }
      setStatus("Queued — processing in the background.");
      router.push("/app/admin");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
      setStatus(null);
    }
  }

  const totalMb = files.reduce((s, f) => s + f.size, 0) / 1048576;

  return (
    <div className="max-w-[640px]">
      <h1 className="text-[1.6rem] font-extrabold tracking-tight mb-1">New bid request</h1>
      <p className="text-[14px] text-bw-body mb-6">
        Drop a PlanHub project <strong>zip or a single PDF</strong> per project — or several at once. The system unzips (or takes the PDF as-is), drops the junk files, reads the package, scores every trade, and queues priced drafts for review.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <Card className="p-5">
          <div className="font-semibold mb-2">1 · The project files (zip or PDF)</div>
          <input type="file" accept=".zip,.pdf,application/zip,application/x-zip-compressed,application/pdf" multiple onChange={onPick} className="block w-full text-[13px]" />
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
          {files.length > 0 && (
            <p className="mt-2 text-[12px] text-bw-muted">{files.length} project{files.length > 1 ? "s" : ""} · {totalMb.toFixed(0)} MB total — keep this tab open until uploads finish.</p>
          )}
        </Card>

        <Card className="p-5 space-y-4">
          <div className="font-semibold">2 · The area</div>
          <p className="text-[12px] text-bw-muted">Default for the batch — the system overrides each project with the ZIP read off its spec cover when it can.</p>
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
          <p className="text-[12px] text-bw-muted">Triage drops takeoffs/bonds/admin files, then scans all trades in one read and extracts only the bid trades.</p>
        </Card>

        {error && <p className="text-[13px] text-bw-red">{error}</p>}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy || !files.length}>
            {busy ? "Working…" : `Upload & analyze${files.length > 1 ? ` (${files.length})` : ""}`}
          </Button>
          {status && <span className="text-[13px] text-bw-body">{status}</span>}
        </div>
      </form>
    </div>
  );
}

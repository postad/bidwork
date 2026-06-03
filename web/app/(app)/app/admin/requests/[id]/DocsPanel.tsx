"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createRequestUploads, rescoreRequest } from "./actions";

export type DocRow = { filename: string; bytes: number | null; pageCount: number | null };

export function DocsPanel({ bidRequestId, docs, processing }: { bidRequestId: string; docs: DocRow[]; processing: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onRescore() {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    try {
      setStatus("Preparing upload…");
      const { uploads } = await createRequestUploads(bidRequestId, files.map((f) => ({ name: f.name })));
      for (let i = 0; i < files.length; i++) {
        setStatus(`Uploading ${i + 1}/${files.length}…`);
        const { error } = await supabase.storage.from("bid-docs").uploadToSignedUrl(uploads[i].path, uploads[i].token, files[i]);
        if (error) throw error;
      }
      setStatus("Re-scanning the package…");
      await rescoreRequest(bidRequestId, files.map((f, i) => ({ name: f.name, path: uploads[i].path, size: f.size })));
      setFiles([]);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  return (
    <section className="mb-9">
      <div className="flex items-baseline gap-2 mb-1">
        <h2 className="text-[1.2rem] font-extrabold tracking-tight">Documents</h2>
        <span className="text-[13px] text-bw-muted">— the package the engine reads</span>
      </div>
      <p className="text-[13px] text-bw-body mb-4">
        The engine scans every file together. Missing a referenced sheet? Add it and re-score — a new doc can flip a no-bid to bid and clear gaps.
      </p>

      <div className="bg-white rounded-2xl border border-bw-border overflow-hidden">
        <div className="divide-y divide-bw-border">
          {docs.length === 0 ? (
            <div className="px-5 py-4 text-[13px] text-bw-muted">No documents.</div>
          ) : (
            docs.map((d, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3">
                <div className="w-8 h-10 bg-bw-green-tint rounded flex items-center justify-center flex-shrink-0">
                  <span className="font-mono text-[8px] font-bold text-bw-green">PDF</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium truncate">{d.filename}</div>
                  <div className="text-[12px] text-bw-muted font-mono">
                    {d.pageCount ? `${d.pageCount} pp` : ""}
                    {d.pageCount && d.bytes ? " · " : ""}
                    {d.bytes ? `${(Number(d.bytes) / 1048576).toFixed(1)} MB` : ""}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-t border-bw-border bg-bw-surface/50">
          <label className="text-[13px] text-bw-body">
            <input type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} disabled={busy} />
            <span className="inline-flex items-center gap-1.5 cursor-pointer font-semibold text-bw-green hover:text-bw-green-hover">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 16V4M6 10l6-6 6 6" /><path d="M4 18v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>
              {files.length ? `${files.length} file${files.length === 1 ? "" : "s"} selected` : "Add document"}
            </span>
          </label>
          <div className="flex items-center gap-3">
            {status && <span className="text-[12px] text-bw-body">{status}</span>}
            {error && <span className="text-[12px] text-bw-red">{error}</span>}
            <button
              onClick={onRescore}
              disabled={busy || !files.length}
              className="inline-flex items-center gap-1.5 bg-bw-text text-white font-semibold text-[13px] px-4 py-2 rounded-full transition hover:bg-bw-green disabled:bg-[#C9D1C7] disabled:cursor-not-allowed"
            >
              {busy ? "Re-scoring…" : "Add & re-score"}
            </button>
          </div>
        </div>
      </div>
      {processing && (
        <p className="text-[12px] text-bw-amber mt-2 inline-flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-bw-amber animate-pulse" /> Scanning in progress — trade scores and pricing update when it finishes.
        </p>
      )}
    </section>
  );
}

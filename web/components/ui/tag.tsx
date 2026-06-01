import { type ReactNode } from "react";

type Tone = "green" | "amber" | "blue" | "red" | "purple" | "neutral";

const tones: Record<Tone, string> = {
  green: "bg-bw-green-tint text-bw-green-deep",
  amber: "bg-bw-amber-tint text-bw-amber",
  blue: "bg-bw-blue-tint text-bw-blue",
  red: "bg-bw-red-tint text-bw-red",
  purple: "bg-bw-purple-tint text-bw-purple",
  neutral: "bg-bw-surface text-bw-body border border-bw-border",
};

export function Tag({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-full px-2.5 py-1 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

// Bid status → tone, mirroring the dashboard mockup.
export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { tone: Tone; label: string }> = {
    draft: { tone: "neutral", label: "Draft" },
    ready: { tone: "green", label: "Ready to review" },
    approved: { tone: "blue", label: "Approved" },
    sent: { tone: "blue", label: "Sent" },
    declined: { tone: "red", label: "Declined" },
  };
  const s = map[status] ?? { tone: "neutral" as Tone, label: status };
  return <Tag tone={s.tone}>{s.label}</Tag>;
}

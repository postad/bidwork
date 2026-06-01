import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-bw-border bg-white">
        <div className="max-w-[1100px] mx-auto px-6 h-16 flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-[14px] font-medium text-bw-body hover:text-bw-text">
              Log in
            </Link>
            <Link href="/login">
              <Button>Try free</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="max-w-[1100px] mx-auto px-6 py-20">
          <div className="bw-eyebrow mb-3">Auto-bidding for trade subcontractors</div>
          <h1 className="text-[2.8rem] font-extrabold tracking-tight leading-tight max-w-[18ch] mb-5">
            Stop writing bids on <span className="text-bw-green">Sundays</span>.
          </h1>
          <p className="text-[17px] text-bw-body max-w-[60ch] mb-8">
            BidWork reads the drawings and specs of an incoming bid invitation and auto-drafts a
            professional, branded proposal — priced from <em>your own</em> charged prices. Review,
            edit, and send in one click. Replies route straight to your inbox.
          </p>
          <div className="flex gap-3">
            <Link href="/login">
              <Button>Try free for 14 days</Button>
            </Link>
            <Link href="#how">
              <Button variant="outline">See how it works</Button>
            </Link>
          </div>
        </section>

        <section id="how" className="max-w-[1100px] mx-auto px-6 pb-24 grid sm:grid-cols-3 gap-4">
          {[
            ["Set your pricing", "Answer a short questionnaire — or upload past bids. That’s your Pricing DNA."],
            ["Get matched bids", "We read the full set, flag what’s unclear, and draft a priced proposal."],
            ["Approve & send", "Review, tweak, send. Reply-to is you — we stay out of the conversation."],
          ].map(([title, body], i) => (
            <Card key={i} className="p-5">
              <div className="font-semibold mb-1">
                {i + 1}. {title}
              </div>
              <p className="text-[13px] text-bw-body">{body}</p>
            </Card>
          ))}
        </section>
      </main>

      <footer className="border-t border-bw-border bg-white">
        <div className="max-w-[1100px] mx-auto px-6 py-6 text-[12px] text-bw-muted">
          BidWork · auto-bidding for local trades
        </div>
      </footer>
    </div>
  );
}

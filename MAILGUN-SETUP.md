# Mailgun setup — Model A (shared sending domain)

Email sending (bids + say-hi) and delivery/open tracking. **Model A:** all mail sends
from **one BidWork-controlled domain** (`getbidwork.com`), with the **From display
name = the contractor's company** and **Reply-To = the contractor's email**. So:

- The GC sees e.g. **`The Shade Company <bids@send.getbidwork.com>`** and replies go
  straight to the contractor (BidWork never sees the reply).
- **Contractors do ZERO DNS** — only you verify `getbidwork.com` once.
- Tradeoff: the address is on `getbidwork.com`, not the contractor's domain. The
  fully-native "from your own email" upgrade is connected-mailbox (Model C), later.

## 1 · Mailgun account + sending domain (getbidwork.com)
1. Create a Mailgun account.
2. Add the sending domain — recommend a subdomain, **`send.getbidwork.com`**
   (Sending → Domains → Add New Domain). Using a subdomain keeps your root domain's
   email reputation separate.
3. Add the DNS records Mailgun shows for `send.getbidwork.com` and **verify**:
   - **TXT (SPF)** and **TXT (DKIM)** — required for sending/deliverability.
   - **CNAME (tracking)** — required for open tracking (the ✓✓ read signal).
   - (MX records are only for *receiving*; not needed for Model A.)

## 2 · Keys
- **Sending API key:** Mailgun → Send → API keys (or Settings → API keys). Format `key-…`.
- **Webhook signing key:** Mailgun → Settings → Webhooks → **HTTP webhook signing key**.

## 3 · Env vars (Vercel → Project → Settings → Environment Variables, Production)
| Var | Value |
|---|---|
| `MAILGUN_API_KEY` | the sending API key |
| `MAILGUN_DOMAIN` | the verified domain, e.g. `send.getbidwork.com` |
| `MAILGUN_FROM_EMAIL` | the From **address** only, e.g. `bids@send.getbidwork.com` (the display name is set per-send to the contractor's company; defaults to `bids@<MAILGUN_DOMAIN>` if unset) |
| `MAILGUN_WEBHOOK_SIGNING_KEY` | the webhook signing key |

**Redeploy** the Vercel app after adding env vars (they're read at runtime per deploy).

> The same `MAILGUN_*` vars (except the signing key) also need to be set in **Trigger.dev**
> env *only if* email is ever sent from a Trigger task. Today bid-send + say-hi run in
> Next server actions (Vercel), so Vercel env is enough.

## 4 · Webhooks → status tracking
Mailgun → Settings → **Webhooks** → add the app endpoint for these events:
- **Delivered messages** → `https://<your-app>/api/webhooks/mailgun`  → sets ✓ Delivered
- **Opened messages** → same URL → sets ✓✓ Read
- (optional) **Permanent failures / Spam complaints** → same URL → sets Failed

The route verifies Mailgun's HMAC with `MAILGUN_WEBHOOK_SIGNING_KEY` and updates
`emails.status` (never downgrading). Open tracking also requires the tracking CNAME
(step 1) and is enabled per-message in code (`o:tracking-opens`, HTML body).

## 5 · Test
Send a bid or a say-hi to an address you control → check the dashboard/network status
goes **Delivered**, then **Read** when you open it.

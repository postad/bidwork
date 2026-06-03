# Mailgun setup

Email sending (bids + say-hi) and delivery/open tracking. The app code is done; this
is the account + env wiring. Replies are NOT tracked here by design — reply-to is the
contractor's own address, so replies go to their inbox, not through Mailgun. (True
"replied" status needs mailbox-connect, a later item.)

## 1 · Mailgun account + sending domain
1. Create a Mailgun account.
2. Add a **sending domain** — a subdomain you control, e.g. `bid.shadesco.com`
   (Sending → Domains → Add New Domain).
3. Add the DNS records Mailgun shows to that domain's DNS and **verify**:
   - **TXT (SPF)** and **TXT (DKIM)** — required for sending/deliverability.
   - **CNAME (tracking)** — required for open tracking (the ✓✓ read signal).
   - (MX records are only for *receiving*; not needed here.)

## 2 · Keys
- **Sending API key:** Mailgun → Send → API keys (or Settings → API keys). Format `key-…`.
- **Webhook signing key:** Mailgun → Settings → Webhooks → **HTTP webhook signing key**.

## 3 · Env vars (Vercel → Project → Settings → Environment Variables, Production)
| Var | Value |
|---|---|
| `MAILGUN_API_KEY` | the sending API key |
| `MAILGUN_DOMAIN` | the verified domain, e.g. `bid.shadesco.com` |
| `MAILGUN_FROM` | e.g. `The Shade Company <bids@bid.shadesco.com>` |
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

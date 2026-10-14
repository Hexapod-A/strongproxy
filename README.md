# StrongProxy

Residential and mobile proxies for Nigerian buyers, paid in naira (Paystack) or USDT (NOWPayments).
Zero-stock reseller model: the customer tops up a wallet first, buys GB from the balance, and only then is
bandwidth bought upstream, automatically, through the provider's API. Every order is delivered instantly; there is
no manual queue. Default provider: **Proxies.sx** (no reseller deposit). **DataImpulse** is an optional alternative per product.

Stack: Next.js 16 (App Router, TypeScript) · Supabase (Postgres, Auth, RLS) · Tailwind v4 · Docker / Coolify.

---

## What's in it

**Customers**
- Landing page with naira pricing (read live from the database), countries, FAQ, Terms / Acceptable Use / Privacy.
- Email + password sign-up (Supabase Auth) with a required Terms + AUP checkbox (checked in the browser **and** on the server; acceptance time is stored on the profile).
- Dashboard: wallet balance, buy GB (type, country or "any", quantity), my proxies with copy buttons, a
  string generator (country, rotating/sticky, HTTP/SOCKS5, `host:port:user:pass` or URL), usage meter (live from the provider), top-up, order and transaction history.

**Daily ports** (dedicated mobile port rented per day, Proxies.sx reseller ports API): see "Daily ports" below.
- Buy: country (only countries with free ports), 1 / 7 / 30 days, HTTP or SOCKS5. Wallet charged, port created instantly, customer sees `host:port:user:pass` (switch HTTP/SOCKS5 port), a **Rotate IP** button and a personal **rotate link** for scripts.
- Live countdown; **renew from the wallet** any time before expiry. Expired ports can't be renewed, so they disappear once the time is up.

**Payments** (wallet-based)
- Paystack: server initialises the transaction, webhook verifies `x-paystack-signature` (HMAC-SHA512 of the raw body), then re-checks the transaction with Paystack's verify API before crediting.
- NOWPayments (USDT): hosted invoice priced in USD at an admin-set ₦/$ rate; IPN verified with `x-nowpayments-sig` (HMAC-SHA512 of the key-sorted JSON). Only `finished` payments are credited; partial payments and re-deposits are not auto-credited.
- Crediting is idempotent in SQL: webhook retries never double-credit.

**Delivery** (provider adapter layer, `src/lib/providers/`), instant, no manual step
- Each product (Mobile, Residential) names its provider in **Admin → Overview → Delivery provider per product**: **Proxies.sx** (default for both) or **DataImpulse**.
- On purchase the wallet is debited and the provider is called in the same request: Proxies.sx mints one capped key per customer per product (later orders top up the same key); DataImpulse creates/tops up a sub-user. The customer sees host/port/user/pass on the dashboard right away.
- **If the provider call fails**, the order is marked failed **and the wallet is refunded in full in the same database transaction** (`fail_and_refund_order`), you get a Telegram/email alert with the provider's error, and the customer sees *"We couldn't deliver this order, so your wallet was refunded…"*.
- If the product's provider has no keys in env, the purchase is refused **before** charging (and you're alerted).
- **Out-of-stock countries can't be bought.** Proxies.sx publishes live stock (`GET /gateway/pool/stock`); the buy page greys out sold-out countries per product and the server re-checks before charging. DataImpulse publishes no stock feed, so for it the admin's country on/off toggles are what customers see.

**Admin** (`/admin`)
- Orders (all / delivered / failed + refunded / stuck): provider error on every failed order; refund button for an order stuck in *processing* (provider call never returned).
- Users: search, credit/debit wallet (with a note, audit-logged), ban/unban (a ban also disables the user's Proxies.sx keys / DataImpulse sub-users).
- Prices & countries: edit ₦/GB, min/max GB, on-sale toggle, add/disable countries.
- Delivery provider per product (Proxies.sx / DataImpulse) with **Configured / Not set** status and the live out-of-stock list.
- Settings: ₦ per $ rate for crypto, minimum top-up.
- Integration status (Configured / Not set). **Keys are read from env only; they are never stored in the DB or shown.**

**Abuse protection**
- Terms of Service + Acceptable Use Policy pages (no fraud, carding, spam, account-creation abuse, credential attacks, illegal activity).
- ToS checkbox at sign-up (enforced server-side), admin ban (blocks app access and upstream keys/sub-users).
- Rate limits (Postgres-backed, survive restarts): sign-up 5/hour/IP, login 20/15 min/IP, top-up 10/10 min/user and 20/10 min/IP, purchases 6/min/user, usage API 30/min/user.

---

## Architecture in one minute

```
src/
  app/                      pages, server actions, API routes
    api/webhooks/paystack   Paystack webhook
    api/webhooks/nowpayments NOWPayments IPN
    api/proxies/[id]/usage  usage meter (provider API)
  lib/
    services/payments.ts    Paystack + NOWPayments init + webhook verification
    services/orders.ts      purchase → instant delivery, auto-refund on failure
    providers/              adapter interface + Proxies.sx + DataImpulse + registry
    stock.ts                live country stock per product
    store.ts                narrow data interface (Supabase in prod, pg in tests)
supabase/migrations/        schema, RLS, SQL functions
supabase/seed.sql           products, countries, settings
test/                       vitest: real-Postgres flow tests + unit tests
```

- Money is integer kobo. All balance changes happen in `SECURITY DEFINER` SQL functions (`confirm_payment`, `place_order`, `fulfil_order`, `fail_and_refund_order`, `refund_order`, `admin_adjust_balance`) that **only the service role** can execute. Balance can't go negative (DB constraint + row lock).
- RLS: customers can read only their own profile, orders, payments, wallet transactions and proxy accounts; they can't write anything directly. Settings, audit log and rate limits are invisible to them.
- Prices are always read from the `products` table inside `place_order`; the browser never sends a price.

### Adding another upstream (Proxy-Cheap, CatProxies, ...)
1. Create `src/lib/providers/<name>.ts` implementing `ProxyProvider` (`isConfigured`, `supportsPool`, `provision`, `getUsage`, optional `setBlocked`, optional `getStock`, `buildProxyString`).
2. Read its keys from env in `src/lib/env.ts`.
3. Add it to `getProviders()` and `PROVIDER_IDS` in `src/lib/providers/index.ts`, extend the `products.provider` check constraint in a new migration, and add its string builder to `src/lib/proxy-format.ts`. It then appears in the per-product provider picker.

### Adding a product type (e.g. datacenter)
The seed already has a `datacenter` row switched off. Turn it on in **Admin → Prices & countries**, or insert a row:
```sql
insert into products (id, name, description, price_per_gb_kobo, provider_pool, provider, min_gb, max_gb, sort_order)
values ('datacenter', 'Datacenter', 'Fast IPs for bulk work.', 300000, 'datacenter', 'dataimpulse', 1, 1000, 3);
```
`provider_pool` is our pool name; each adapter maps it (DataImpulse `pool_type`; Proxies.sx `mbl`/`peer`). Proxies.sx has no datacenter pool, so datacenter must use DataImpulse.

---

## Proxies.sx: what's verified and what isn't

Proxies.sx has two reseller APIs. Their port/day API (`/reseller/customers`, `/reseller/ports`, priced per proxy per day)
doesn't fit per-GB selling, so this app uses their **per-GB Pool Gateway with Pool Access Keys** (`pak_…`), the model
their own open-source reseller kit is built on. Sources read on 13 Oct 2026:
- https://www.proxies.sx/reseller-docs and https://www.proxies.sx/reseller-docs/reference (OpenAPI: `https://api.proxies.sx/v1/reseller/docs/openapi`)
- MIT reseller kit: https://github.com/bolivian-peru/proxy-reseller-kit (`packages/sdk/src/client.ts`, `types.ts`, `url.ts`, `docs/USERNAME-DSL.md`)
- Live stock feed: `https://api.proxies.sx/v1/gateway/pool/stock` (public, called and parsed on 13 Oct 2026)

Endpoints used (base `https://api.proxies.sx/v1`, header `X-API-Key`):

| Purpose | Call |
|---|---|
| New customer key with a GB cap | `POST /reseller/pool-keys` `{label, trafficCapGB}` + `Idempotency-Key: mint_<order id>` → `{id, key: "pak_…", trafficCapGB, trafficUsedMB, enabled, …}` |
| Reorder (add GB) | `POST /reseller/pool-keys/:id/topup` `{addTrafficGB}` + `Idempotency-Key: topup_<order id>` |
| Re-enable a key that hit its cap | `PATCH /reseller/pool-keys/:id` `{enabled: true}` (the SDK says top-up does **not** re-enable) |
| Usage meter | `GET /reseller/pool-keys/:id` → `trafficUsedMB` vs `trafficCapGB` (1 GB = 1024 MB per the SDK) |
| Ban | `PATCH /reseller/pool-keys/:id` `{enabled: false}` |
| Unmask a key if the mint reply hides it | `POST /reseller/pool-keys/:id/reveal` |
| Country stock | `GET /gateway/pool/stock` → `pools.mbl[cc]` (mobile modems), `ipTypes.peer[cc].residential` (residential) |

Proxy strings: host `gw.proxies.sx`, HTTP `7000`, SOCKS5 `7001`, password = the `pak_` key, username
`<PROXIES_SX_PROXY_USERNAME>-<pool>-<country|any>[-iptype-residential][-sid-<id>-rot-sticky]`.
**Mobile** → pool `mbl` (their own 4G/5G modems: only US, UK, FR, NL, PL and Georgia; **Germany has no mobile stock**).
**Residential** → pool `peer` + `-iptype-residential`. Rotating = gateway default (new IP about every 10 minutes). Sticky = `-sid-<id>-rot-sticky`.
A key isn't tied to a country: customers can switch country any time in the string generator.

Stock on 13 Oct 2026 for your countries: mobile in stock in US/UK/FR/NL only; residential in US/UK/CA/DE/FR/NL/NO, out in AU/ES.
The buy page reads this live (cached 60 s), so it changes on its own. If the stock feed is down, purchases are allowed (a key works in any in-stock country).

**Not confirmed (test with a live key and a 1 GB order before taking real orders):**
1. **Which API-key scopes** the pool-key endpoints need. The quick start only lists `customers:*` / `ports:*` scopes. Create the key in client.proxies.sx and try one order.
2. **Billing:** whether a key minted with `trafficCapGB = N` charges N GB from your Proxies.sx balance up front or as traffic is used. Either way, keep your Proxies.sx balance above the GB you've sold.
3. **Burn rate:** their pricing feed bills cheaper countries at a fraction of a GB (Premium = 1.0: US, UK, CA, AU, DE, FR, NL, NO; Spain is "Plus" at 0.375). We assume the cap counts Premium-equivalent GB.
4. **Error body shape** (any non-2xx is treated as a failure; the message goes into the admin alert and the order's failure reason).
5. **Webhooks:** pool-key events (`pak.usage.threshold_crossed`, `pak.expired`, …) exist only as a design doc in their kit, so nothing depends on them. Usage is read on demand; keys have **no expiry** unless you set `PROXIES_SX_KEY_EXPIRY_DAYS`.

These are also marked in the header of `src/lib/providers/proxiessx.ts`.

---

## DataImpulse: what's verified and what isn't

Implemented against DataImpulse's own docs, read on 13 Oct 2026:
- Reseller API (Postman): https://documenter.getpostman.com/view/6095389/2s9YC7UC2x
- Sub-users via API: https://help.dataimpulse.com/en/articles/15931697-managing-sub-users-via-api
- Proxy syntax: https://docs.dataimpulse.com/proxies/parameters/country, `/session-id`, `/types-of-connections`, `/connection-hosts`

Endpoints used (base `https://api.dataimpulse.com/reseller`):

| Purpose | Call |
|---|---|
| Token (24 h TTL) | `POST /user/token/get` form fields `login`, `password` |
| Create sub-user | `POST /sub-user/create` `{label, threads, sticky_range, pool_type}` → `{id, login, password, ...}` |
| Add traffic | `POST /sub-user/balance/add` `{subuser_id, traffic}` |
| Read sub-user | `GET /sub-user/get?subuser_id=` |
| Usage meter | `GET /sub-user/balance/get?subuser_id=` → `balance`, `balance_total`, `balance_used` (bytes) |
| Ban | `POST /sub-user/set-blocked` `{subuser_id, blocked}` |

Proxy strings: host `gw.dataimpulse.com`, rotating HTTP port 823, SOCKS5 824, sticky ports 10000+ (each sub-user gets range 10000–10999), country via `login__cr.us`, sticky session via `login__cr.us;sessid.abc`.

**Not confirmed by the docs (test with a live key, 1 GB first, before turning on auto mode):**
1. **Unit of `traffic` in `balance/add`.** The docs say only "int". The addition-history example (`traffic_added` 1 → `balance_charged` 1) is consistent with whole GB, so the adapter sends whole GB. Check the sub-user shows exactly 1 GB after your first test order.
2. Whether **mobile** sub-users use the same gateway host/ports as residential (the docs show one gateway).
3. The exact shape of **error responses** (any non-2xx or `{success:false}` is treated as a failure).

These are also marked in the code header of `src/lib/providers/dataimpulse.ts`.
Reminder from the research: the DataImpulse reseller program needs a $50 deposit, ID verification and a signed reseller agreement. Until then, keep both products on Proxies.sx.

---

## Daily ports (Proxies.sx per-day dedicated mobile ports)

**What Proxies.sx actually charges (read 14 Oct 2026):** there is **no per-day or per-country port price** on their live pages or public API.
Their pricing page says *"Endpoints stay free. Create ports anytime. You never pay per port or per rotation"*; their API reference
(`GET https://api.proxies.sx/v1/reseller/docs/llm`) says wholesale is metered **$4/GB** of traffic (volume discount down to $2.40/GB) and port
creation charges your reseller balance. So the real cost is the same $4/GB in US, UK, Canada, Australia, Germany, France, Spain, Netherlands and Norway,
paid as the customer uses data. The `$2/day` in their Quick Start is labelled an example. (Their older Quick Start also says creation costs
`basePrice × days`; use **Admin → Daily ports → Check live cost** with your key to see what your account is really charged.)

That's why every plan carries a **data allowance** that we set as the customer's Proxies.sx traffic quota. An "unlimited" port means you pay for every GB.

| Plan | Data included | Your cost at $4/GB | Seeded price (≈2× at ₦1,330/$) |
|------|---------------|--------------------|-------------------------------|
| 1 day | 2 GB | $8 | ₦21,280 |
| 7 days | 10 GB | $40 | ₦106,400 |
| 30 days | 30 GB | $120 | ₦319,200 |

All editable in **Admin → Daily ports** (price, GB, on/off; GB 0 = no cap), plus the ₦/$ rate and the $/GB and $/day costs used for the suggested price.

**Flow** (`src/lib/services/ports.ts`, `src/lib/providers/proxiessx-ports.ts`, migration `20261014000003_day_ports.sql`):
1. Refused **before charging** if: no `PROXIES_SX_API_KEY`, daily ports switched off, plan/country disabled, country out of stock, no Proxies.sx country id, or the low-balance auto-pause is on.
2. `place_port_order` debits the wallet and creates the order (`kind = 'port'`) in one transaction.
3. Proxies.sx calls: find/create our customer (`GET /reseller/customers/by-external-id/:userId`, `POST /reseller/customers`), `PATCH /reseller/customers/:id/quota { portSlotsDelta: 1, trafficGBDelta }`, `POST /reseller/ports { customerId, countryId, days }` (order id sent as `Idempotency-Key`).
4. `fulfil_port_order` stores server IP, HTTP + SOCKS5 ports, login, password and expiry.
5. **Any error →** `fail_and_refund_order` (full refund, same transaction), the port/slot is cleaned up upstream, you get a Telegram/email alert.
- **Renew:** `POST /reseller/ports/:id/extend { days }`, only while the port is active and not expired; failure is refunded the same way.
- **Rotate:** `POST /reseller/ports/:id/rotate` from the dashboard button or the customer's link `GET|POST /api/ports/rotate/<secret token>` (6 per minute per port).
- **Expiry:** Proxies.sx has **no `port.expired` webhook**, so ports are re-read (`GET /reseller/ports/:id`) when the customer opens Daily ports (at most every 5 minutes); a port deleted upstream or past its expiry stops showing.
- **Webhook** `POST /api/webhooks/proxiessx`: verifies `X-Webhook-Signature: sha256=HMAC-SHA256(body, PROXIES_SX_WEBHOOK_SECRET)` and applies `port.deleted`, `port.suspended`, `port.unsuspended`, `port.rotated`. Register it with `POST /reseller/webhooks { url, events, secret }`.
- **Admin:** daily-port orders appear in **Orders** (filter "Daily ports"), with the same refund tools.

**Not confirmed (test with a live key and one 1-day port before selling):**
1. **Country ids / stock.** Their docs say `countryId` comes "from device availability" but name no reseller endpoint. We call `GET /countries/with-devices?pool=dedicated` (what their own dashboard uses) with the API key and parse it defensively. If that fails, Admin → Daily ports shows "couldn't be read": paste the Proxies.sx country id per country there and those countries become buyable.
2. **Cost:** per-GB-only vs `basePrice × days` (see above). If calculate-price shows a day rate, enter it as "Port cost per day" so suggested prices and the auto-pause include it.
3. **Extend body:** the LLM reference says `{ "days": N }`, the HTML reference shows `{ "hours": 720 }`. We send `days`.
4. Whether the customer **traffic quota** hard-stops traffic when used up, and whether an API key needs `ports:rotate` / `billing:read` scopes (create the key with all of: `customers:read customers:write ports:read ports:write ports:rotate billing:read`).
5. `expiresAt` format (examples use epoch ms; ISO is accepted too). Idempotency-Key on ports is not documented (sent anyway, harmless).

## Low-balance auto-pause

Every Proxies.sx sale (per-GB keys **and** daily ports) is paid from **your** Proxies.sx balance. The app reads it from `GET /account/summary`
(documented in their API reference; the API-key scope it needs is unconfirmed), cached 60 seconds.
- Balance below your threshold (default **$5**) → Proxies.sx products and daily ports show **"temporarily unavailable"**, the buy button is disabled, and you get one Telegram/email alert. Sales **resume on their own** (with a "resumed" alert) once the balance is back above the threshold.
- Balance below what one order would cost (GB × $/GB, plus days × $/day for ports) → that order is refused with nothing charged, and you're alerted.
- Re-checked right before every wallet charge. If the balance can't be read, sales stay open and the auto-refund remains the safety net.
- **Admin → Daily ports**: on/off toggle (default ON), threshold, cost settings, current balance.
- DataImpulse products are not affected.


## Why NOWPayments for crypto

- Its API docs (read 13 Oct 2026, https://documenter.getpostman.com/view/7907941/2s93JusNJt) document exactly what this needs: a hosted invoice (`POST /v1/invoice`) and an **HMAC-SHA512-signed IPN webhook**, plus a sandbox for testing. No custom checkout UI to build.
- It supports USDT on TRC20 (low network fees, the network most Nigerian P2P traders use). The invoice can be locked to it with `NOWPAYMENTS_PAY_CURRENCY=usdttrc20`.
- Payouts go to your own wallet address, so you don't need a foreign bank account.
- Cryptomus is a reasonable alternative with a similar invoice + webhook model; swapping it in means adding an `initCryptomus` / `handleCryptomusWebhook` pair beside the NOWPayments ones in `src/lib/services/payments.ts`.
- **Check yourself when you sign up (not verified here):** current fees, whether your account needs KYC, and the minimum payment per coin (USDT minimums can be a few dollars, so keep the minimum top-up at ₦1,000+).

---

## Run it locally

Prerequisites: Node 22, Docker (for the local Supabase).

```bash
npm ci
npx supabase start -x studio,realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta,mailpit
npx supabase status -o env          # copy API_URL, ANON_KEY, SERVICE_ROLE_KEY
cp .env.example .env.local          # fill NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY, ADMIN_EMAILS
npm run dev                         # http://localhost:3000
```
`supabase start` applies the migration and seed. Sign up with the email you put in `ADMIN_EMAILS` to get `/admin`.

Try deliveries without real keys (DataImpulse mock):
```bash
node test/e2e/mock-dataimpulse-server.mjs 3900 &
DATAIMPULSE_API_BASE=http://127.0.0.1:3900/reseller DATAIMPULSE_LOGIN=x DATAIMPULSE_PASSWORD=y npm run dev
```
then set a product's provider to **DataImpulse** in Admin → Overview. (The Proxies.sx adapter is covered by the mocked tests; `PROXIES_SX_API_BASE` points it at any mock server.)

### Checks
```bash
npm run typecheck
npm run lint
npm test        # needs the local Supabase DB on 127.0.0.1:54322 (or TEST_DATABASE_URL); creates a throwaway database "sp_test"
npm run build
```
The tests run the real migration on Postgres and cover: Paystack webhook → balance (valid, replayed, bad signature, short amount, failed verify), NOWPayments IPN, purchase → Proxies.sx adapter with a mocked API (capped key minted with the order id as idempotency key, reorder tops up + re-enables the same key, residential `peer` pool, usage), provider failure → failed order + **automatic full refund** + admin alert, out-of-stock countries refused with nothing charged, provider without keys refused before charging, purchase → DataImpulse adapter (create, then top-up of the same sub-user; failure → auto-refund), Proxies.sx proxy-string DSL and stock parsing, banned/inactive/insufficient-balance rules, admin credit/debit, rate limiting, RLS (customers can't read others' rows or write balances), and daily ports against a mocked Proxies.sx ports API (`test/ports.test.ts`: buy, renew, rotate, expiry sync, signed webhooks, failure → full refund + alert, out-of-stock and disabled countries refused with nothing charged, missing country id, low-balance auto-pause for ports and per-GB, fail-open). 51 tests.

---

## Deploy on Coolify + Supabase (step by step)

RAM budget: the app container idles around 120–200 MB (Node is capped at 256 MB heap at runtime). The build step needs ~1 GB; if your VPS is tight, build on Coolify while nothing else heavy is running, or build the image elsewhere and pull it.

### 1. Supabase
You already self-host Supabase on Coolify. In that Supabase:
1. **SQL editor** → paste and run `supabase/migrations/20261013000001_init.sql`, then `supabase/migrations/20261013000002_providers_no_manual.sql`, then `supabase/migrations/20261014000003_day_ports.sql` (daily ports + auto-pause; seeds the plans and settings), then `supabase/seed.sql`. (Already ran some? Run only the ones you haven't, in order; the second refunds anything left in the old manual queue.)
2. **Authentication → URL configuration**: Site URL = `https://YOUR_DOMAIN`; add `https://YOUR_DOMAIN/auth/callback` to redirect URLs.
3. **Authentication → Providers → Email**: keep "Confirm email" on for production (configure SMTP in Supabase so confirmation emails go out). Customers land on `/auth/callback` after confirming.
4. Copy the **API URL**, **anon key** and **service_role key** (in Coolify they're in your Supabase service's environment variables).

### 2. The app
1. Push this repo to GitHub (private). In Coolify: **New resource → Private repository (GitHub App)** → pick the repo, branch `main`.
2. Build pack: **Dockerfile**. Port: **3000**.
3. **Environment variables**: paste everything from `.env.example` with real values. Mark `NEXT_PUBLIC_*` vars as **build-time** too ("Build Variable" checkbox), because Next.js inlines them at build time. Mark keys as secret.
4. Domain: set `https://YOUR_DOMAIN`. Coolify issues the TLS certificate.
5. Deploy. Health check: `GET /api/health`.
6. Sign up on the live site with the email in `ADMIN_EMAILS`. (Optional, permanent: `update profiles set role = 'admin' where email = 'you@example.com';`)

### 3. Paystack
1. Dashboard → **Settings → API Keys & Webhooks**. Copy the **secret key** into `PAYSTACK_SECRET_KEY` (use the test key first).
2. Webhook URL: `https://YOUR_DOMAIN/api/webhooks/paystack`.
3. Test: top up ₦1,000 with Paystack's test card; the wallet updates when the webhook lands (refresh the wallet page).

### 4. NOWPayments (USDT)
1. Create an account, add your USDT (TRC20) payout wallet.
2. In the dashboard's payment settings, create an API key → `NOWPAYMENTS_API_KEY`.
3. In the same payment settings, generate the IPN secret key → `NOWPAYMENTS_IPN_SECRET`. The callback URL is sent with each invoice automatically (`/api/webhooks/nowpayments`).
4. Set the ₦ per $ rate you actually get for USDT in **Admin → Overview** (it's used to price invoices). Update it when the market moves.
5. Optional sandbox: `NOWPAYMENTS_SANDBOX=true` with sandbox keys.

### 5. Proxies.sx (default provider, no deposit)
1. Sign up at https://client.proxies.sx and add balance (their per-GB price is $4/GB for your Premium countries, cheaper with volume).
2. Copy your proxy username (`psx_…`) into `PROXIES_SX_PROXY_USERNAME` and create a reseller API key into `PROXIES_SX_API_KEY` (see https://www.proxies.sx/reseller-docs, Step 1).
3. Redeploy. Admin → Overview shows Proxies.sx **Configured** for Mobile and Residential, plus today's out-of-stock countries.
4. Buy 1 GB yourself from the site and check the key in the Proxies.sx dashboard (see "Not confirmed" above).
5. **Daily ports:** give the API key the scopes `customers:read customers:write ports:read ports:write ports:rotate billing:read`. Open **Admin → Daily ports**: check the balance shows, the countries show "In stock" (or paste country ids), press **Check live cost**, adjust prices. Then buy one 1-day port yourself and test the rotate link.
6. **Webhook (optional):** pick a long random secret, put it in `PROXIES_SX_WEBHOOK_SECRET`, redeploy, then register `https://<your-site>/api/webhooks/proxiessx` with `POST /reseller/webhooks` (events `port.deleted`, `port.suspended`, `port.unsuspended`, `port.rotated`, same secret).

### 6. DataImpulse (optional, when you have the $50)
1. Complete KYC, sign the reseller agreement, deposit $50.
2. Put your dashboard login/password in `DATAIMPULSE_LOGIN` / `DATAIMPULSE_PASSWORD`. (Optional: a white-label host in `DATAIMPULSE_PROXY_HOST`.)
3. Redeploy. Admin → Overview shows DataImpulse **Configured**. Switch a product to DataImpulse there.
4. Do one real 1 GB test order and check the sub-user in DataImpulse's dashboard (see "Not confirmed" above).

### 7. Alerts
- Telegram: talk to @BotFather → `/newbot` → token into `TELEGRAM_BOT_TOKEN`. Send your bot any message, open `https://api.telegram.org/bot<TOKEN>/getUpdates`, copy `chat.id` into `TELEGRAM_CHAT_ID`.
- Email: `RESEND_API_KEY` (verify your domain in Resend) **or** `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`; plus `ADMIN_NOTIFY_EMAIL` and `NOTIFY_EMAIL_FROM`.

---

## Security notes
- No secrets in the repo; `.env*` is git-ignored (only `.env.example` is committed).
- The service-role key is used only on the server. The browser never talks to Supabase directly.
- Webhooks verify signatures before touching the database; Paystack payments are re-verified with Paystack's API.
- Every admin money action and ban writes to `audit_log`.
- Banning a user disables their Proxies.sx keys / blocks their DataImpulse sub-users.
- Provider keys (Proxies.sx, DataImpulse) are read from env only, never stored in the database or shown in the admin.

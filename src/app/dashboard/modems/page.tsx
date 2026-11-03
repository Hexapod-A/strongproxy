import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ModemCard } from "@/components/ModemCard";
import { PageTitle } from "@/components/PageTitle";
import { adminStore, requireUser } from "@/lib/auth";
import { flag } from "@/lib/catalog";
import { siteUrl } from "@/lib/env";
import { formatNaira } from "@/lib/money";
import { notifyAdmin } from "@/lib/notify";
import { getModemsApi, getPortsApi } from "@/lib/providers";
import { salesStatus } from "@/lib/services/balance-guard";
import { isProfitable, modemOffers, modemPriceKobo, modemPricing, MODEM_PERIOD_LIST, reconcileModemOrders, sellPriceUsd, syncModems } from "@/lib/services/modems";
import { createAdminClient } from "@/lib/supabase/server";
import type { PrivateModem } from "@/lib/types";

export const metadata = { title: "Private modems" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LABEL = { day: "1 day", week: "1 week", month: "1 month" } as const;
const stillRunning = (modems: PrivateModem[]) => {
  const now = Date.now();
  return modems.filter((m) => new Date(m.expires_at).getTime() > now);
};

export default async function ModemsPage({ searchParams }: { searchParams: Promise<{ new?: string; setup?: string }> }) {
  const s = await requireUser();
  const { new: fresh } = await searchParams;
  const db = createAdminClient();
  const store = adminStore();
  const api = getModemsApi();
  const deps = { store, notify: notifyAdmin, api, balance: getPortsApi() };

  // Finish any setup that was still running when the customer left the page, then refresh expiry/status.
  await reconcileModemOrders(deps, s.userId);
  const load = async () =>
    ((await db.from("private_modems").select("*").eq("user_id", s.userId).eq("status", "active").order("expires_at", { ascending: true })).data ?? []) as PrivateModem[];
  let modems = await load();
  if (await syncModems(deps, modems)) modems = await load();
  modems = stillRunning(modems);

  const [pricing, open, sales] = await Promise.all([
    modemPricing(store),
    store.listOpenModemOrders(s.userId),
    salesStatus({ store, notify: notifyAdmin, reader: getPortsApi() }),
  ]);
  const { lines } = modems.length ? await modemOffers(api, pricing) : { lines: [] };

  const renewPrices = (m: PrivateModem) => {
    const out: Partial<Record<"day" | "week" | "month", number>> = {};
    for (const p of MODEM_PERIOD_LIST) {
      const sp = sellPriceUsd(pricing, m.country_code, m.carrier_name ?? "", p);
      if (sp.hidden) continue;
      const cost = lines.find((l) => l.countryCode === m.country_code && l.carrierName === m.carrier_name && l.period === p)?.priceUsd;
      if (cost !== undefined && !isProfitable(cost, sp.usd, pricing.minMarginUsd)) continue;
      out[p] = modemPriceKobo(sp.usd, pricing.rate);
    }
    return out;
  };
  const creds = (host: string | null, port: number | null, u: string | null, pw: string | null) => (host && u && pw ? { host, port, username: u, password: pw } : null);

  return (
    <>
      <PageTitle
        title="Private modems"
        subtitle="A whole 4G/5G modem, just for you. Unlimited data. Change the IP whenever you want."
        action={<Link href="/dashboard/modems/rent" className="btn-primary btn-sm">Rent a modem</Link>}
      />
      {open.length > 0 && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-line bg-card px-5 py-4 text-sm">
          <span className="pulse-dot h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
          <span>
            Setting up {open.length === 1 ? "your modem" : `${open.length} orders`} ({open.map((o) => `${o.modem_country_name ?? ""} ${o.modem_carrier ?? ""}, ${LABEL[o.modem_period ?? "day"]}, ${formatNaira(o.total_kobo)}`).join(" · ")}).
            This usually takes under a minute. If it can&apos;t be set up, the money goes back to your wallet.
          </span>
          <AutoRefresh />
        </div>
      )}
      {fresh && modems.length > 0 && open.length === 0 && (
        <div className="mb-6 rounded-xl border border-accent/30 bg-ok-bg px-5 py-4 text-sm text-accent-ink">Your modem is ready. Copy the login below.</div>
      )}
      {modems.length === 0 ? (
        open.length === 0 && (
          <div className="card flex flex-col items-start gap-4 p-8">
            <p className="font-medium">No active modems</p>
            <p className="max-w-md text-sm text-muted">
              Rent a whole modem for a day, a week or a month. Unlimited data, your own HTTP and SOCKS5 port, and a new IP whenever you want.
            </p>
            <Link href="/dashboard/modems/rent" className="btn-primary btn-sm">Rent a modem</Link>
          </div>
        )
      ) : (
        <div className="space-y-5">
          {modems.map((m) => (
            <ModemCard
              key={m.id}
              balanceKobo={s.profile.balance_kobo}
              renewBlocked={sales.paused || !pricing.enabled}
              modem={{
                id: m.id,
                title: `${m.country_name ?? m.country_code.toUpperCase()}${m.carrier_name ? ` · ${m.carrier_name}` : ""}`,
                flag: flag(m.country_code),
                http: creds(m.http_host, m.http_port, m.http_username, m.http_password),
                socks: creds(m.socks_host, m.socks_port, m.socks_username, m.socks_password),
                online: m.online,
                expires_at: m.expires_at,
                rotateUrl: `${siteUrl()}/api/modems/rotate/${m.rotate_token}`,
                renew: renewPrices(m),
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}

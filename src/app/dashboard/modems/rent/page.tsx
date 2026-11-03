import Link from "next/link";
import { PageTitle } from "@/components/PageTitle";
import { adminStore, requireUser } from "@/lib/auth";
import { flag } from "@/lib/catalog";
import { notifyAdmin } from "@/lib/notify";
import { getModemsApi, getPortsApi } from "@/lib/providers";
import { salesStatus } from "@/lib/services/balance-guard";
import { modemOffers, modemPricing } from "@/lib/services/modems";
import { ModemRentForm } from "./ModemRentForm";

export const metadata = { title: "Rent a private modem" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function RentModemPage() {
  const s = await requireUser();
  const store = adminStore();
  const api = getModemsApi();
  const pricing = await modemPricing(store);
  const [{ live, buyable, offers }, sales] = await Promise.all([
    modemOffers(api, pricing),
    salesStatus({ store, notify: notifyAdmin, reader: getPortsApi() }),
  ]);
  const flags = Object.fromEntries(offers.map((o) => [o.code, flag(o.code)]));
  const blockedReason = !pricing.enabled
    ? "Private modems aren't available right now."
    : sales.paused
      ? "Private modems are temporarily unavailable. Check back soon."
      : !buyable
        ? "Private modem rentals open soon. Prices and stock below are live."
        : null;

  return (
    <>
      <PageTitle
        title="Rent a private modem"
        subtitle="A whole 4G/5G modem on a real carrier, just for you. Unlimited data, paid from your wallet."
        action={<Link href="/dashboard/modems" className="btn-ghost btn-sm">My modems</Link>}
      />
      {!live ? (
        <div className="card p-8 text-sm text-muted">Live stock couldn&apos;t be loaded just now. Refresh in a minute.</div>
      ) : offers.length === 0 ? (
        <div className="card p-8 text-sm text-muted">No private modems available right now. Check back soon.</div>
      ) : (
        <ModemRentForm offers={offers} flags={flags} balanceKobo={s.profile.balance_kobo} canBuy={buyable} blockedReason={blockedReason} />
      )}
    </>
  );
}

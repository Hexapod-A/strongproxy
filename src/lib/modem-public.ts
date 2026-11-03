import "server-only";
import { flag } from "@/lib/catalog";
import { getModemsApi } from "@/lib/providers";
import { MODEM_PERIOD_LIST, modemOffers, modemPriceKobo, normalizePricing, type ModemPricing } from "@/lib/services/modems";
import { createPublicClient } from "@/lib/supabase/server";

export type PublicModemPlan = { period: "day" | "week" | "month"; priceKobo: number; from: boolean; perDayKobo: number };
export type PublicModemOffer = {
  enabled: boolean;
  live: boolean;
  plans: PublicModemPlan[];
  countries: { code: string; name: string; flag: string; inStock: boolean }[];
};

const DAYS = { day: 1, week: 7, month: 30 } as const;

async function publicPricing(): Promise<ModemPricing> {
  const sb = createPublicClient();
  if (!sb) return normalizePricing(null);
  try {
    const { data, error } = await sb.rpc("public_modem_pricing");
    if (error) throw error;
    return normalizePricing(data as Parameters<typeof normalizePricing>[0]);
  } catch (e) {
    console.error("public modem pricing unavailable", e);
    return normalizePricing(null);
  }
}

/** Prices + live countries for the public pages. Works with no keys at all (default prices, public price list). */
export async function getPublicModemOffer(): Promise<PublicModemOffer> {
  const pricing = await publicPricing();
  const { live, lines, offers } = await modemOffers(getModemsApi(), pricing);
  const plans = MODEM_PERIOD_LIST.map((period) => {
    const selling = lines.filter((l) => l.period === period && l.state === "selling").map((l) => l.priceKobo);
    const base = modemPriceKobo(pricing.prices[period], pricing.rate);
    const min = selling.length ? Math.min(...selling) : base;
    const from = selling.length > 1 && new Set(selling).size > 1;
    return { period, priceKobo: min, from, perDayKobo: Math.round(min / DAYS[period] / 100) * 100 };
  });
  return {
    enabled: pricing.enabled,
    live,
    plans,
    countries: offers.map((o) => ({ code: o.code, name: o.name, flag: flag(o.code), inStock: o.inStock })),
  };
}

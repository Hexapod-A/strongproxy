import Link from "next/link";
import type { Country } from "@/lib/types";

export function countryList(countries: Country[]): string {
  const names = countries.map((c) => (["us", "gb", "nl"].includes(c.code) ? `the ${c.name}` : c.name));
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

export function faqItems(countryNames: string): { q: string; a: React.ReactNode }[] {
  return [
  {
    q: "Mobile or residential, which do I need?",
    a: "Residential IPs come from home broadband connections and suit most work: research, scraping, price checks. Mobile IPs come from cellular networks; platforms trust them the most, so pick mobile for social media and app traffic.",
  },
  {
    q: "How do I pay?",
    a: "Top up your wallet in naira with Paystack (card, bank transfer or USSD), or in USDT. Then buy GB from your wallet balance. No subscription.",
  },
  {
    q: "How fast do I get my proxies?",
    a: "Instantly. The moment you pay from your wallet, your host, port, username and password appear on your dashboard with copy buttons. If an order can't be delivered, it is refunded to your wallet automatically.",
  },
  {
    q: "Can I pick the country?",
    a: `Yes. Choose ${countryNames}, or leave it on any country for a random location. Stock is live: a country that is sold out right now is greyed out at checkout. You can change targeting per connection with the string generator.`,
  },
  {
    q: "HTTP or SOCKS5?",
    a: "Both. Your dashboard gives you ready-to-paste strings for HTTP(S) and SOCKS5, rotating (a new IP per request) or sticky (the same IP for a while).",
  },
  {
    q: "What am I not allowed to do?",
    a: (
      <>
        No fraud, carding, spam, mass account creation, or anything illegal. Accounts that break the{" "}
        <Link href="/acceptable-use" className="link-u">Acceptable Use Policy</Link> are banned without refund.
      </>
    ),
  },
];
}

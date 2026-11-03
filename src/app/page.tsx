import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { getCatalog, flag } from "@/lib/catalog";
import { Hero, FactStrip } from "@/components/landing/Hero";
import { Features } from "@/components/landing/Features";
import { Integrations } from "@/components/landing/Integrations";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Pricing } from "@/components/landing/Pricing";
import { UseCases, Locations, Faq, CtaBand } from "@/components/landing/Sections";
import { faqItems, countryList } from "@/components/landing/faq";
import { PrivateModems } from "@/components/landing/PrivateModems";
import { getPublicModemOffer } from "@/lib/modem-public";

export const revalidate = 300;

export default async function Home() {
  const [{ products, countries }, modems] = await Promise.all([getCatalog(), getPublicModemOffer()]);
  const flags = Object.fromEntries(countries.map((c) => [c.code, flag(c.code)]));
  const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@example.com";
  const priceProducts = products.map(({ id, name, description, price_per_gb_kobo, min_gb, max_gb }) => ({ id, name, description, price_per_gb_kobo, min_gb, max_gb }));

  return (
    <>
      <SiteHeader />
      <main>
        <Hero products={products} countries={countries} flags={flags} />
        <FactStrip products={products} countries={countries} />
        <Features countries={countries} flags={flags} />
        <Integrations />
        <HowItWorks />
        <section id="pricing" className="section-y">
          <div className="container-x">
            <div className="mx-auto mb-12 max-w-2xl text-center">
              <p data-reveal className="eyebrow">Pricing</p>
              <h2 data-reveal className="h-section mt-4">Simple pay-per-GB pricing</h2>
              <p data-reveal className="mt-4 text-[17px] text-ink-2">Pay only for the data you use. No plans, no hidden fees.</p>
            </div>
            <Pricing products={priceProducts} countryCount={countries.length} />
            <div className="mt-20 sm:mt-24">
              <PrivateModems offer={modems} />
            </div>
          </div>
        </section>
        <UseCases />
        <Locations countries={countries} flags={flags} />
        <Faq items={faqItems(countryList(countries))} />
        <CtaBand email={email} />
      </main>
      <SiteFooter />
    </>
  );
}

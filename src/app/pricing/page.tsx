import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { getCatalog } from "@/lib/catalog";
import { Pricing } from "@/components/landing/Pricing";
import { Faq, CtaBand } from "@/components/landing/Sections";
import { faqItems, countryList } from "@/components/landing/faq";

export const revalidate = 300;
export const metadata = { title: "Pricing", description: "Residential and mobile proxies priced per GB, paid in naira or USDT." };

export default async function PricingPage() {
  const { products, countries } = await getCatalog();
  const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@example.com";
  const priceProducts = products.map(({ id, name, description, price_per_gb_kobo, min_gb, max_gb }) => ({ id, name, description, price_per_gb_kobo, min_gb, max_gb }));
  return (
    <>
      <SiteHeader />
      <main>
        <section className="relative overflow-hidden">
          <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_70%_70%_at_50%_0%,black,transparent)]" />
          <div className="container-x relative pb-16 pt-14 sm:pb-24 sm:pt-20">
            <div className="mx-auto mb-12 max-w-2xl text-center">
              <p data-reveal className="eyebrow">Pricing</p>
              <h1 data-reveal className="mt-4 text-[40px] font-semibold leading-[1.04] tracking-[-0.04em] sm:text-6xl">Pay per GB. Nothing else.</h1>
              <p data-reveal className="mt-5 text-[17px] text-ink-2">
                Top up your wallet in naira or USDT, then buy the data you need. Pick from {countries.length} countries.
              </p>
            </div>
            <Pricing products={priceProducts} countryCount={countries.length} />
          </div>
        </section>
        <Faq items={faqItems(countryList(countries))} />
        <CtaBand email={email} />
      </main>
      <SiteFooter />
    </>
  );
}

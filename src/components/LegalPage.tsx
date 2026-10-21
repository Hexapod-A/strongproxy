import Link from "next/link";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { LegalTabs } from "./LegalTabs";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="border-b border-line bg-card">
          <div className="container-x pb-10 pt-12 sm:pb-12 sm:pt-16">
            <p className="eyebrow">Legal</p>
            <h1 className="mt-3 text-[34px] font-semibold tracking-[-0.035em] sm:text-5xl">{title}</h1>
            <p className="mt-3 text-sm text-muted">Last updated {updated}</p>
            <LegalTabs />
          </div>
        </section>
        <div className="container-x py-12 sm:py-16">
          <article className="mx-auto max-w-[720px]">
            <div className="legal space-y-5 text-[16px] leading-[1.75] text-ink-2 [&_a]:underline [&_a]:decoration-line-2 [&_a]:underline-offset-[3px] [&_a]:transition-colors [&_a:hover]:decoration-ink [&_a:hover]:text-ink [&_h2]:mt-12 [&_h2]:scroll-mt-28 [&_h2]:border-t [&_h2]:border-line [&_h2]:pt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-[-0.01em] [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_li]:marker:text-line-2 [&_ul]:space-y-2.5">
              {children}
            </div>
            <div className="mt-14 flex flex-col gap-4 rounded-2xl border border-line bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[15px] text-ink-2">Questions about this page? We&rsquo;re happy to explain.</p>
              <Link href="/#faq" className="btn-ghost btn-sm">Read the FAQ</Link>
            </div>
          </article>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

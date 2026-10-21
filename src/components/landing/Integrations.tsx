import { CodeTabs } from "./CodeTabs";

const TOOLS = ["cURL", "Python", "Node.js", "Go", "PHP", "Java", "Playwright", "Puppeteer", "Selenium", "Scrapy", "Chrome", "Firefox", "Antidetect browsers", "Phone apps"];

export function Integrations() {
  return (
    <section className="section-y overflow-hidden">
      <div className="container-x grid items-center gap-12 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
        <div>
          <p data-reveal className="eyebrow">Easy setup</p>
          <h2 data-reveal className="h-section mt-4">Plug in anywhere</h2>
          <p data-reveal className="mt-4 max-w-md text-[17px] leading-relaxed text-ink-2">
            If your app or tool supports HTTP(S) or SOCKS5 proxies, it works with StrongProxy. Copy your details from the dashboard
            and you&rsquo;re connected.
          </p>
        </div>
        <div data-reveal className="min-w-0">
          <CodeTabs />
        </div>
      </div>
      <div data-reveal className="marquee relative mt-16 [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
        <div className="marquee-track flex w-max gap-3">
          {[...TOOLS, ...TOOLS].map((t, i) => (
            <span
              key={i}
              aria-hidden={i >= TOOLS.length}
              className="whitespace-nowrap rounded-full border border-line-2 bg-card px-4 py-2 text-sm text-ink-2 transition-colors hover:border-ink hover:text-ink"
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

"use client";

import { useState } from "react";

const PROXY = "http://USERNAME:PASSWORD@HOST:PORT";
const SNIPPETS: { id: string; label: string; code: string }[] = [
  { id: "curl", label: "cURL", code: `curl -x ${PROXY} https://api.ipify.org` },
  {
    id: "python",
    label: "Python",
    code: `import requests\n\nproxy = "${PROXY}"\nr = requests.get("https://api.ipify.org",\n                 proxies={"http": proxy, "https": proxy})\nprint(r.text)`,
  },
  {
    id: "node",
    label: "Node.js",
    code: `import { ProxyAgent, fetch } from "undici";\n\nconst agent = new ProxyAgent("${PROXY}");\nconst res = await fetch("https://api.ipify.org", { dispatcher: agent });\nconsole.log(await res.text());`,
  },
  {
    id: "playwright",
    label: "Playwright",
    code: `const browser = await chromium.launch({\n  proxy: {\n    server: "http://HOST:PORT",\n    username: "USERNAME",\n    password: "PASSWORD",\n  },\n});`,
  },
];

export function CodeTabs() {
  const [tab, setTab] = useState(SNIPPETS[0].id);
  const [copied, setCopied] = useState(false);
  const cur = SNIPPETS.find((s) => s.id === tab) ?? SNIPPETS[0];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cur.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: nothing to do */
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-ink bg-ink shadow-[0_30px_60px_-36px_rgba(14,15,12,0.6)]">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-2 py-2">
        <div role="tablist" aria-label="Code examples" className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none]">
          {SNIPPETS.map((s) => (
            <button
              key={s.id}
              role="tab"
              type="button"
              aria-selected={tab === s.id}
              onClick={() => setTab(s.id)}
              className={`shrink-0 rounded-md px-3 py-1.5 text-[13px] transition-[background-color,color,transform,translate,scale] duration-200 active:scale-95 ${tab === s.id ? "bg-white/10 text-white" : "text-white/50 hover:bg-white/5 hover:text-white/85"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={copy}
          className={`shrink-0 rounded-md border px-3 py-1.5 text-[12px] transition-[background-color,border-color,color,transform,translate,scale] duration-200 active:scale-95 ${copied ? "border-lime bg-lime text-ink" : "border-white/15 text-white/70 hover:border-white/40 hover:text-white"}`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre key={cur.id} className="fade-in min-h-[188px] overflow-x-auto whitespace-pre-wrap break-all p-5 font-mono text-[13px] leading-6 text-white/85">
        <code>
          {cur.code.split("\n").map((line, i) => (
            <span key={i} className="flex">
              <span className="mr-4 inline-block w-4 shrink-0 select-none text-right text-white/25">{i + 1}</span>
              <span className="min-w-0">{line || " "}</span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

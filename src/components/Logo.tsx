import Link from "next/link";

/** Text-set wordmark: a solid square mark + "StrongProxy". */
export function Logo({ href = "/", invert = false }: { href?: string; invert?: boolean }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-2.5" aria-label="StrongProxy home">
      <span
        aria-hidden
        className={`grid h-7 w-7 place-items-center rounded-[7px] ${invert ? "bg-lime text-ink" : "bg-ink text-lime"}`}
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square">
          <path d="M3 5h10M3 11h10M8 2v12" />
        </svg>
      </span>
      <span className={`text-[17px] tracking-[-0.02em] ${invert ? "text-white" : "text-ink"}`}>
        <span className="font-semibold">Strong</span>
        <span className="font-normal">Proxy</span>
      </span>
    </Link>
  );
}

import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="container-x py-24">
        <p className="eyebrow">404</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em]">This page doesn&rsquo;t exist.</h1>
        <Link href="/" className="btn-primary mt-8">Back home</Link>
      </main>
    </>
  );
}

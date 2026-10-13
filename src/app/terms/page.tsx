import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Terms of Service" };

export default function Terms() {
  const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@example.com";
  return (
    <LegalPage title="Terms of Service" updated="13 October 2026">
      <p>
        These terms govern your use of StrongProxy (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By creating an account you agree to them and to
        our <Link href="/acceptable-use" className="underline underline-offset-2">Acceptable Use Policy</Link>, which forms part of these terms.
      </p>
      <h2>1. The service</h2>
      <p>
        We resell access to proxy networks operated by third-party providers. You buy traffic (measured in GB) from your prepaid
        wallet and receive credentials to route your own traffic. We do not guarantee that any particular website will accept
        proxy traffic, or any specific speed, uptime or IP location beyond the country you select.
      </p>
      <h2>2. Your account</h2>
      <ul>
        <li>You must be at least 18 years old and give accurate information.</li>
        <li>You are responsible for everything done with your account and your proxy credentials. Do not share or resell them.</li>
        <li>One person, one account. Multiple accounts to get around a ban or a limit are not allowed.</li>
      </ul>
      <h2>3. Wallet, payments and refunds</h2>
      <ul>
        <li>Wallet top-ups are made through Paystack (naira) or our crypto payment processor (USDT and other coins). A top-up is credited once the payment is confirmed by the processor.</li>
        <li>Wallet balances are not interest-bearing and cannot be withdrawn as cash, except where the law requires it.</li>
        <li>An order we could not deliver is refunded to your wallet automatically. Traffic that has been delivered or used is not refundable.</li>
        <li>Crypto payments are final once sent; underpaid invoices are not credited automatically. Contact support with your reference.</li>
        <li>Prices are shown in naira per GB and may change. The price you pay is the price shown when you place the order.</li>
      </ul>
      <h2>4. Suspension and termination</h2>
      <p>
        We may suspend or close your account, revoke your proxy credentials and withhold any remaining balance, without notice, if
        we reasonably believe you have broken these terms or the Acceptable Use Policy, if our upstream provider reports abuse
        from your credentials, or if required by law. We cooperate with law enforcement and may share account information when
        legally required.
      </p>
      <h2>5. Liability</h2>
      <p>
        The service is provided &ldquo;as is&rdquo;. To the extent permitted by law, our total liability to you is limited to the amount
        you paid us in the 30 days before the claim. We are not liable for indirect losses, lost profits, or the actions of
        websites you access through the service.
      </p>
      <h2>6. Changes</h2>
      <p>We may update these terms. Continued use after a change means you accept the updated terms.</p>
      <h2>7. Contact</h2>
      <p>
        Questions: <a href={`mailto:${email}`} className="underline underline-offset-2">{email}</a>.
      </p>
    </LegalPage>
  );
}

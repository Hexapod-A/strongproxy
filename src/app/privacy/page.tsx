import { LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Privacy" };

export default function Privacy() {
  const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@example.com";
  return (
    <LegalPage title="Privacy" updated="13 October 2026">
      <p>We collect the minimum we need to run the service.</p>
      <h2>What we store</h2>
      <ul>
        <li>Your email address, name (if given) and the date you accepted our terms.</li>
        <li>Your wallet transactions, payments and orders.</li>
        <li>The proxy credentials issued to you, and usage figures reported by our providers.</li>
        <li>IP addresses used to sign in and make purchases, for rate limiting and abuse prevention.</li>
      </ul>
      <h2>Who we share it with</h2>
      <ul>
        <li>Payment processors (Paystack, our crypto processor) to take your payment. We never see your full card details.</li>
        <li>Upstream proxy providers, only an anonymous account label, to issue your credentials.</li>
        <li>Law enforcement, when legally required.</li>
      </ul>
      <h2>Your choices</h2>
      <p>
        You can ask us to delete your account at <a href={`mailto:${email}`} className="underline underline-offset-2">{email}</a>. We keep
        payment records as long as the law requires.
      </p>
    </LegalPage>
  );
}

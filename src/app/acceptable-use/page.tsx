import { LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Acceptable Use Policy" };

export default function AcceptableUse() {
  const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@example.com";
  return (
    <LegalPage title="Acceptable Use Policy" updated="13 October 2026">
      <p>
        Our proxy networks are shared with real people and run by upstream providers who cut off abusers. To keep the service
        available for everyone, the following are strictly forbidden. Breaking any of them gets your account banned with no
        refund, and we may report it.
      </p>
      <h2>Forbidden</h2>
      <ul>
        <li><strong>Fraud of any kind:</strong> carding, using stolen cards or accounts, payment or refund fraud, chargeback abuse, phishing, impersonation.</li>
        <li><strong>Spam:</strong> bulk email, SMS or messaging, comment or review spam, SEO spam.</li>
        <li><strong>Account creation abuse:</strong> mass registration of accounts, bonus or promo abuse, fake engagement, bot farms.</li>
        <li><strong>Credential attacks:</strong> credential stuffing, brute force, account takeover attempts.</li>
        <li><strong>Attacks on systems:</strong> DDoS or load testing against sites you do not own, vulnerability scanning without permission, malware distribution or command-and-control.</li>
        <li><strong>Illegal content and activity:</strong> anything illegal in Nigeria or in the country of the IP you use, including child sexual abuse material, which we report.</li>
        <li><strong>Harassment:</strong> stalking, doxxing, threatening or harassing anyone.</li>
        <li><strong>Reselling</strong> or sharing your credentials without our written agreement.</li>
      </ul>
      <h2>Technical limits</h2>
      <ul>
        <li>Mail ports (SMTP, IMAP and similar) are blocked by our providers.</li>
        <li>Some websites (for example government and banking sites) may be blocked by our providers.</li>
        <li>We may rate-limit or pause traffic that looks automated against a single target at abusive volume.</li>
      </ul>
      <h2>Enforcement</h2>
      <p>
        We review abuse reports from our providers and from website owners. We may ban your account, revoke credentials and
        keep any remaining balance. If you believe we made a mistake, write to{" "}
        <a href={`mailto:${email}`} className="underline underline-offset-2">{email}</a> with your account email.
      </p>
      <h2>Report abuse</h2>
      <p>
        Seeing abusive traffic from our network? Email <a href={`mailto:${email}`} className="underline underline-offset-2">{email}</a>{" "}
        with timestamps (UTC), the IPs involved and the target.
      </p>
    </LegalPage>
  );
}

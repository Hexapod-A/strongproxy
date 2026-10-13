import { notifyConfig } from "./env";

export type Notifier = (subject: string, text: string) => Promise<{ telegram: boolean; email: boolean }>;

/** Best-effort admin notification. Never throws: a failed alert must not break a payment or order. */
export const notifyAdmin: Notifier = async (subject, text) => {
  const c = notifyConfig();
  const out = { telegram: false, email: false };

  if (c.telegramToken && c.telegramChatId) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${c.telegramToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: c.telegramChatId, text: `${subject}\n\n${text}`, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(8000),
      });
      out.telegram = res.ok;
    } catch (e) {
      console.error("telegram notify failed", e);
    }
  }

  if (c.to) {
    try {
      if (c.resendKey) {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${c.resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: c.from, to: [c.to], subject, text }),
          signal: AbortSignal.timeout(8000),
        });
        out.email = res.ok;
      } else if (c.smtpHost) {
        const nodemailer = await import("nodemailer");
        const transport = nodemailer.createTransport({
          host: c.smtpHost,
          port: c.smtpPort,
          secure: c.smtpPort === 465,
          auth: c.smtpUser ? { user: c.smtpUser, pass: c.smtpPass } : undefined,
        });
        await transport.sendMail({ from: c.from, to: c.to, subject, text });
        out.email = true;
      }
    } catch (e) {
      console.error("email notify failed", e);
    }
  }
  return out;
};

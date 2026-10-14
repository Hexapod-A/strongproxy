/** Central env access. Server-only values must never be imported into client components. */
function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export const siteUrl = () => opt("NEXT_PUBLIC_SITE_URL") ?? "http://localhost:3000";
export const siteName = () => opt("NEXT_PUBLIC_SITE_NAME") ?? "StrongProxy";
export const supportEmail = () => opt("NEXT_PUBLIC_SUPPORT_EMAIL") ?? "support@example.com";

export const supabaseUrl = () => opt("NEXT_PUBLIC_SUPABASE_URL");
export const supabaseAnonKey = () => opt("NEXT_PUBLIC_SUPABASE_ANON_KEY");
export const supabaseServiceKey = () => opt("SUPABASE_SERVICE_ROLE_KEY");

export const adminEmails = () =>
  (opt("ADMIN_EMAILS") ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export const paystack = () => ({ secretKey: opt("PAYSTACK_SECRET_KEY") });

export const nowpayments = () => ({
  apiKey: opt("NOWPAYMENTS_API_KEY"),
  ipnSecret: opt("NOWPAYMENTS_IPN_SECRET"),
  payCurrency: opt("NOWPAYMENTS_PAY_CURRENCY"),
  baseUrl: opt("NOWPAYMENTS_SANDBOX") === "true" ? "https://api-sandbox.nowpayments.io/v1" : "https://api.nowpayments.io/v1",
});

export const proxiesSx = () => ({
  apiKey: opt("PROXIES_SX_API_KEY"),
  proxyUsername: opt("PROXIES_SX_PROXY_USERNAME"),
  gatewayHost: opt("PROXIES_SX_GATEWAY_HOST") ?? "gw.proxies.sx",
  keyExpiryDays: opt("PROXIES_SX_KEY_EXPIRY_DAYS") ? Number(opt("PROXIES_SX_KEY_EXPIRY_DAYS")) : null,
  // Only for testing against a mock/staging server. Leave unset in production.
  apiBase: opt("PROXIES_SX_API_BASE"),
  // Secret you set when registering the webhook (POST /reseller/webhooks { secret }). Signs X-Webhook-Signature.
  webhookSecret: opt("PROXIES_SX_WEBHOOK_SECRET"),
});

export const dataimpulse = () => ({
  login: opt("DATAIMPULSE_LOGIN"),
  password: opt("DATAIMPULSE_PASSWORD"),
  proxyHost: opt("DATAIMPULSE_PROXY_HOST") ?? "gw.dataimpulse.com",
  threads: Number(opt("DATAIMPULSE_SUBUSER_THREADS") ?? "50"),
  // Only for testing against a mock/staging server. Leave unset in production.
  apiBase: opt("DATAIMPULSE_API_BASE"),
});

export const notifyConfig = () => ({
  telegramToken: opt("TELEGRAM_BOT_TOKEN"),
  telegramChatId: opt("TELEGRAM_CHAT_ID"),
  resendKey: opt("RESEND_API_KEY"),
  smtpHost: opt("SMTP_HOST"),
  smtpPort: Number(opt("SMTP_PORT") ?? "587"),
  smtpUser: opt("SMTP_USER"),
  smtpPass: opt("SMTP_PASS"),
  from: opt("NOTIFY_EMAIL_FROM") ?? "StrongProxy <alerts@example.com>",
  to: opt("ADMIN_NOTIFY_EMAIL"),
});

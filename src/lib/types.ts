export type Product = {
  id: string;
  name: string;
  description: string;
  price_per_gb_kobo: number;
  provider_pool: string;
  /** Upstream that delivers this product: "proxies_sx" (default) or "dataimpulse". */
  provider: string;
  min_gb: number;
  max_gb: number;
  is_active: boolean;
  sort_order: number;
};

export type Country = {
  code: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  /** Daily ports can be bought in this country (Admin > Daily ports). */
  ports_enabled?: boolean;
  /** Optional manual Proxies.sx countryId; empty = resolved from their live list. */
  psx_country_id?: string | null;
};

export type PortPlan = {
  id: string;
  name: string;
  days: number;
  price_kobo: number;
  /** Data allowance per purchase in GB, pushed to Proxies.sx as the customer's traffic quota. 0 = no cap. */
  traffic_gb: number;
  is_active: boolean;
  sort_order: number;
};

export type DedicatedPort = {
  id: string;
  user_id: string;
  provider: string;
  external_id: string;
  country_code: string | null;
  plan_id: string | null;
  protocol: "http" | "socks5";
  server_ip: string;
  http_port: number | null;
  socks_port: number | null;
  username: string;
  password: string;
  display_name: string | null;
  traffic_gb: number;
  rotate_token: string;
  status: "active" | "suspended" | "deleted" | "expired";
  expires_at: string;
  last_synced_at: string | null;
  last_rotated_at: string | null;
  created_at: string;
};

export type OrderKind = "gb" | "port" | "port_renewal";

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: "customer" | "admin";
  balance_kobo: number;
  is_banned: boolean;
  banned_reason: string | null;
  tos_accepted_at: string | null;
  created_at: string;
};

export type OrderStatus = "processing" | "fulfilled" | "failed" | "refunded";

export type Order = {
  id: string;
  user_id: string;
  /** Set for GB orders; null for daily-port orders. */
  product_id: string | null;
  country_code: string | null;
  /** GB bought, or the plan's data allowance for a daily port (0 = no cap). */
  quantity_gb: number;
  kind?: OrderKind;
  port_plan_id?: string | null;
  port_days?: number | null;
  port_protocol?: string | null;
  dedicated_port_id?: string | null;
  unit_price_kobo: number;
  total_kobo: number;
  status: OrderStatus;
  provider: string | null;
  proxy_account_id: string | null;
  failure_reason: string | null;
  admin_note: string | null;
  fulfilled_at: string | null;
  created_at: string;
};

export type ProxyAccount = {
  id: string;
  user_id: string;
  product_id: string;
  provider: string;
  external_id: string | null;
  host: string;
  port: number;
  username: string;
  password: string;
  protocol: string;
  sticky_port_start: number | null;
  sticky_port_end: number | null;
  traffic_gb_purchased: number;
  notes: string | null;
  created_at: string;
};

export type WalletTx = {
  id: string;
  amount_kobo: number;
  balance_after_kobo: number;
  kind: "topup" | "purchase" | "refund" | "admin_credit" | "admin_debit";
  reference: string | null;
  note: string | null;
  created_at: string;
};

export type Payment = {
  id: string;
  user_id: string;
  provider: "paystack" | "nowpayments";
  reference: string;
  amount_kobo: number;
  status: "pending" | "success" | "failed";
  checkout_url: string | null;
  created_at: string;
};

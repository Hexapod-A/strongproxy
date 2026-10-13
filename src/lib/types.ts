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

export type Country = { code: string; name: string; is_active: boolean; sort_order: number };

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
  product_id: string;
  country_code: string | null;
  quantity_gb: number;
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

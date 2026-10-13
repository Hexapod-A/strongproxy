import { getProvider, getProviders } from "@/lib/providers";
import type { ProxyProvider } from "@/lib/providers/types";
import { formatNaira } from "@/lib/money";
import type { Notifier } from "@/lib/notify";
import { productStock } from "@/lib/stock";
import { StoreError, type Store } from "@/lib/store";
import type { Order } from "@/lib/types";

export type PurchaseInput = {
  userId: string;
  productId: string;
  countryCode: string | null;
  quantityGb: number;
};

export type PurchaseResult =
  | { outcome: "fulfilled"; order: Order; proxyAccountId: string }
  /** The provider call failed: the order is marked failed and the wallet was refunded in full. */
  | { outcome: "refunded"; order: Order; error: string };

export type Deps = {
  store: Store;
  notify: Notifier;
  providers?: ProxyProvider[];
};

/**
 * Buy GB from the wallet. Every order is delivered instantly through the product's provider:
 *  1. refuse before charging if the provider has no keys or the country is out of stock;
 *  2. place_order debits the wallet and creates the order ('processing') atomically;
 *  3. the provider mints/tops up the customer's key; on success fulfil_order stores the credentials;
 *  4. on any provider error fail_and_refund_order marks it failed + refunds, and the admin is alerted.
 * Pre-charge refusals throw StoreError (provider_not_configured, country_out_of_stock, ...), so nothing is charged.
 */
export async function purchase(deps: Deps, input: PurchaseInput): Promise<PurchaseResult> {
  const { store, notify } = deps;
  const providers = deps.providers ?? getProviders();
  const product = await store.getProduct(input.productId);
  if (!product || !product.is_active) throw new StoreError("product_unavailable");
  const provider = getProvider(product.provider, providers);

  if (!provider || !provider.isConfigured() || !provider.supportsPool(product.provider_pool)) {
    await notify(
      `Sales blocked: ${product.name} has no working provider`,
      `A customer tried to buy ${product.name}, but provider "${product.provider}" ${provider ? (provider.isConfigured() ? `doesn't support the ${product.provider_pool} pool` : "has no API keys in env") : "is unknown"}.\nNothing was charged. Set the keys or pick another provider in Admin > Catalog.`,
    );
    throw new StoreError("provider_not_configured");
  }

  const stock = await productStock(provider, product.provider_pool, input.countryCode ? [input.countryCode] : []);
  if (stock.live && stock.countries[input.countryCode ?? ""] === "out_of_stock") throw new StoreError("country_out_of_stock");

  const order = await store.rpc<Order>("place_order", {
    p_user_id: input.userId,
    p_product_id: input.productId,
    p_country_code: input.countryCode,
    p_quantity_gb: input.quantityGb,
  });

  const existing = await store.findProxyAccount(order.user_id, order.product_id, provider.id);
  try {
    const r = await provider.provision({
      customerRef: order.user_id,
      pool: product.provider_pool,
      gb: order.quantity_gb,
      existingExternalId: existing?.external_id ?? null,
      idempotencyKey: order.id,
    });
    const accId = await store.rpc<string>("fulfil_order", {
      p_order_id: order.id,
      p_provider: provider.id,
      p_external_id: r.externalId,
      p_host: r.host,
      p_port: r.port,
      p_username: r.username,
      p_password: r.password,
      p_protocol: r.protocol,
      p_sticky_start: r.stickyPortStart ?? null,
      p_sticky_end: r.stickyPortEnd ?? null,
      p_notes: null,
      p_actor: null,
      p_proxy_account_id: existing ? existing.id : null,
    });
    const fresh = (await store.getOrder(order.id)) ?? order;
    return { outcome: "fulfilled", order: fresh, proxyAccountId: accId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await store.rpc("fail_and_refund_order", { p_order_id: order.id, p_reason: `${provider.id}: ${msg}` });
    await notify(
      `Order FAILED and auto-refunded: ${order.quantity_gb} GB ${product.name}`,
      [
        `Order ${order.id}`,
        `${product.name}, country ${input.countryCode ?? "any"}, ${order.quantity_gb} GB via ${provider.label}`,
        `${provider.label} said: ${msg}`,
        `The customer's wallet was refunded ${formatNaira(order.total_kobo)} automatically.`,
        `Check your ${provider.label} balance and keys.`,
      ].join("\n"),
    );
    const fresh = (await store.getOrder(order.id)) ?? order;
    return { outcome: "refunded", order: fresh, error: msg };
  }
}

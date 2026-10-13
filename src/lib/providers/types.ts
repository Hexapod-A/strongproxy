/**
 * Provider adapter contract. Every upstream (Proxies.sx, DataImpulse, later Proxy-Cheap, CatProxies, ...) implements this.
 * The app never talks to an upstream directly; it goes through the registry in ./index.ts.
 */

export type ProxyPool = "residential" | "mobile" | "datacenter" | string;

export type ProvisionInput = {
  /** Our user id, used as a label upstream so the admin can match sub-users to customers. */
  customerRef: string;
  pool: ProxyPool;
  /** Whole GB to add. */
  gb: number;
  /** If the customer already has an account on this provider for this pool, top it up instead of creating one. */
  existingExternalId?: string | null;
  /** Our order id; providers that support it dedupe retried calls with it. */
  idempotencyKey?: string;
};

/** Live device counts per product pool and ISO country (lower case). A missing or 0 entry = out of stock. */
export type StockSnapshot = {
  byPool: Record<string, Record<string, number>>;
  fetchedAt: string;
};

export type ProvisionResult = {
  externalId: string;
  host: string;
  /** Default (rotating, HTTP) port. */
  port: number;
  username: string;
  password: string;
  protocol: "http" | "socks5";
  stickyPortStart?: number | null;
  stickyPortEnd?: number | null;
  /** True when an existing upstream account was topped up rather than created. */
  toppedUp: boolean;
};

export type UsageResult = {
  /** Bytes still available upstream. */
  remainingBytes: number;
  /** Bytes used so far, when the upstream reports it. */
  usedBytes: number | null;
  /** Total bytes ever allocated, when the upstream reports it. */
  totalBytes: number | null;
};

export type ProxyStringOptions = {
  country?: string | null; // ISO alpha-2 lower case, null = any
  mode: "rotating" | "sticky";
  protocol: "http" | "socks5";
  /** Sticky only: which sticky port to use, or a session id. */
  stickyPort?: number;
  sessionId?: string;
  format: "hostport" | "url";
};

export type AccountForString = {
  host: string;
  port: number;
  username: string;
  password: string;
  sticky_port_start: number | null;
  sticky_port_end: number | null;
};

export interface ProxyProvider {
  readonly id: string;
  readonly label: string;
  /** True when the env carries everything this provider needs. Keys come only from env. */
  isConfigured(): boolean;
  supportsPool(pool: ProxyPool): boolean;
  provision(input: ProvisionInput): Promise<ProvisionResult>;
  getUsage(externalId: string): Promise<UsageResult>;
  /** Block/unblock an upstream account (used when an admin bans a user). */
  setBlocked?(externalId: string, blocked: boolean): Promise<void>;
  /** Live country stock, for providers that publish it. Absent = stock is not exposed (admin toggles countries). */
  getStock?(): Promise<StockSnapshot>;
  /** Build a ready-to-paste proxy string with targeting. */
  buildProxyString(account: AccountForString, opts: ProxyStringOptions): string;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

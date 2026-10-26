import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsonResult, requireEnv, serve } from "./serve.js";

const WOO_URL = requireEnv("WOO_URL");
const AUTH = "Basic " + Buffer.from(`${requireEnv("WOO_KEY")}:${requireEnv("WOO_SECRET")}`).toString("base64");
const STORE_URL = requireEnv("STORE_URL");
const TIMEZONE = process.env.STORE_TIMEZONE ?? "UTC";

const ORDER_STATUSES = ["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"] as const;

async function woo(path: string, { method = "GET", query = {}, body }: { method?: string; query?: Record<string, unknown>; body?: unknown } = {}) {
  const url = new URL(`/wp-json/wc/v3/${path}`, WOO_URL);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: AUTH,
      "Content-Type": "application/json",
      // WooCommerce refuses key auth over plain HTTP. This hop never leaves the cluster,
      // so we tell WordPress to treat it as HTTPS.
      "X-Forwarded-Proto": "https",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // WordPress shows an HTML page when PHP or the database fails
    throw new Error(`WooCommerce returned ${res.status} with a non-JSON response; the store may be down`);
  }
  if (!res.ok) throw new Error(`WooCommerce returned ${res.status}: ${data.message ?? res.statusText}`);
  return data;
}

const product = (p: any) => ({
  id: p.id,
  name: p.name,
  price: p.price,
  status: p.status,
  stock_status: p.stock_status,
  // WordPress builds permalinks for the internal HTTPS-faked request, so link via the public URL instead
  url: `${STORE_URL}/?p=${p.id}`,
});

const order = (o: any) => ({
  id: o.id,
  status: o.status,
  created: o.date_created,
  total: `${o.total} ${o.currency}`,
  customer: `${o.billing.first_name} ${o.billing.last_name}`.trim(),
  email: o.billing.email,
  items: o.line_items.map((i: any) => `${i.quantity} x ${i.name}`),
});

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

function createServer() {
  const server = new McpServer({ name: "woocommerce", version: "0.1.0" });

  server.registerTool(
    "list_products",
    {
      description: "List products in the WooCommerce store, optionally filtered by a search term.",
      inputSchema: {
        search: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    async ({ search, limit }) => jsonResult((await woo("products", { query: { search, per_page: limit } })).map(product)),
  );

  server.registerTool(
    "create_product",
    {
      description: "Create a simple product. It is published to the storefront immediately.",
      inputSchema: {
        name: z.string().min(1),
        price: z.number().positive(),
        description: z.string().optional(),
      },
    },
    async ({ name, price, description }) =>
      jsonResult(product(await woo("products", {
        method: "POST",
        body: { name, regular_price: String(price), description, status: "publish" },
      }))),
  );

  server.registerTool(
    "list_orders",
    {
      description: `List orders, newest first. Dates use the store timezone (${TIMEZONE}).`,
      inputSchema: {
        date: z
          .string()
          .regex(/^(today|\d{4}-\d{2}-\d{2})$/, 'Use "today" or YYYY-MM-DD')
          .optional()
          .describe('"today" or a date as YYYY-MM-DD'),
        status: z.enum(ORDER_STATUSES).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    async ({ date, status, limit }) => {
      const day = date === "today" ? today() : date;
      const orders = await woo("orders", {
        query: {
          status,
          per_page: limit,
          // The whole day, up to midnight, in store time
          after: day && `${day}T00:00:00`,
          before: day && `${nextDay(day)}T00:00:00`,
        },
      });
      return jsonResult(orders.map(order));
    },
  );

  server.registerTool(
    "get_order",
    {
      description: "Get one order with its items, customer and payment details.",
      inputSchema: { id: z.number().int().positive() },
    },
    async ({ id }) => {
      const o = await woo(`orders/${id}`);
      return jsonResult({
        ...order(o),
        payment_method: o.payment_method_title,
        billing_address: o.billing,
        customer_note: o.customer_note,
      });
    },
  );

  server.registerTool(
    "update_order_status",
    {
      description: "Change the status of an order.",
      inputSchema: {
        id: z.number().int().positive(),
        status: z.enum(ORDER_STATUSES),
      },
    },
    async ({ id, status }) => jsonResult(order(await woo(`orders/${id}`, { method: "PUT", body: { status } }))),
  );

  return server;
}

serve(createServer);

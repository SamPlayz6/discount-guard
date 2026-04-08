import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { createHmac } from "node:crypto";
import { analyzeOrder } from "~/lib/detection.server";

// Verify Shopify webhook signature
function verifyWebhook(body: string, hmacHeader: string): boolean {
  const secret = process.env.SHOPIFY_API_SECRET!;
  const hash = createHmac("sha256", secret).update(body).digest("base64");
  return hash === hmacHeader;
}

export async function action({ request }: ActionFunctionArgs) {
  const body = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256") ?? "";
  const shop = request.headers.get("x-shopify-shop-domain") ?? "";

  if (!verifyWebhook(body, hmac)) {
    return json({ error: "Invalid signature" }, { status: 401 });
  }

  let order: any;
  try {
    order = JSON.parse(body);
  } catch (err) {
    console.error("[webhook:orders-create] Failed to parse request body:", err);
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Extract discount code info
  const discountCode = order.discount_codes?.[0]?.code ?? null;
  const discountValue = order.discount_codes?.reduce(
    (sum: number, d: { amount: string }) => sum + parseFloat(d.amount || "0"),
    0,
  ) ?? 0;

  // Get customer IP from order note attributes or browser_ip
  const customerIp = order.browser_ip ?? order.client_details?.browser_ip ?? null;

  await analyzeOrder({
    shop,
    shopifyOrderId: String(order.id),
    discountCode,
    customerEmail: order.email ?? order.contact_email ?? "",
    customerIp,
    shippingAddress: order.shipping_address
      ? {
          address1: order.shipping_address.address1,
          city: order.shipping_address.city,
          zip: order.shipping_address.zip,
          country: order.shipping_address.country_code,
        }
      : null,
    discountValue,
  });

  return json({ ok: true });
}

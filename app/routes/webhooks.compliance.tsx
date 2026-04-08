import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { createHmac } from "node:crypto";
import { supabase } from "~/lib/supabase.server";

// Verify Shopify webhook signature
function verifyWebhook(body: string, hmacHeader: string): boolean {
  const secret = process.env.SHOPIFY_API_SECRET!;
  const hash = createHmac("sha256", secret).update(body).digest("base64");
  return hash === hmacHeader;
}

export async function action({ request }: ActionFunctionArgs) {
  const body = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256") ?? "";
  const topic = request.headers.get("x-shopify-topic") ?? "";
  const shop = request.headers.get("x-shopify-shop-domain") ?? "";

  if (!verifyWebhook(body, hmac)) {
    return json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch (err) {
    console.error("[webhook:compliance] Failed to parse request body:", err);
    return json({ error: "Invalid JSON" }, { status: 400 });
  }

  switch (topic) {
    case "customers/data_request":
      // Respond with stored data for the customer
      // We only store hashed emails, so no PII to return
      console.log(`Data request from ${shop} for customer ${payload.customer?.id}`);
      break;

    case "customers/redact": {
      // Delete order records matching the customer email
      const email = payload.customer?.email;
      if (email) {
        await supabase.from("orders").delete().eq("shop", shop).eq("customer_email", email);
        console.log(`Customer redact from ${shop}: deleted orders for ${email}`);
      }
      break;
    }

    case "shop/redact":
      // Delete all shop data including sessions
      await supabase.from("abuse_flags").delete().eq("shop", shop);
      await supabase.from("orders").delete().eq("shop", shop);
      await supabase.from("sessions").delete().eq("shop", shop);
      await supabase.from("merchants").delete().eq("shop", shop);
      console.log(`Shop redact: deleted all data for ${shop}`);
      break;
  }

  return json({ ok: true });
}

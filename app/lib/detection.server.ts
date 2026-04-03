import { createHash } from "node:crypto";
import { supabase, flagAbuse } from "./supabase.server";

interface OrderData {
  shop: string;
  shopifyOrderId: string;
  discountCode: string | null;
  customerEmail: string;
  customerIp: string | null;
  shippingAddress: {
    address1?: string;
    city?: string;
    zip?: string;
    country?: string;
  } | null;
  discountValue: number;
}

// Hash PII for storage (GDPR compliant)
function hashPII(value: string): string {
  return createHash("sha256").update(value.toLowerCase().trim()).digest("hex");
}

// Normalize email: strip +aliases and dots in Gmail
function normalizeEmail(email: string): string {
  const [local, domain] = email.toLowerCase().split("@");
  if (!local || !domain) return email.toLowerCase();

  let normalized = local;
  // Remove +alias
  const plusIdx = normalized.indexOf("+");
  if (plusIdx > 0) normalized = normalized.substring(0, plusIdx);
  // Remove dots for Gmail
  if (domain === "gmail.com") normalized = normalized.replace(/\./g, "");

  return `${normalized}@${domain}`;
}

// Hash shipping address for comparison
function hashAddress(addr: OrderData["shippingAddress"]): string | null {
  if (!addr?.address1) return null;
  const parts = [addr.address1, addr.city, addr.zip, addr.country]
    .filter(Boolean)
    .join("|")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return hashPII(parts);
}

export async function analyzeOrder(order: OrderData): Promise<void> {
  if (!order.discountCode) return; // No discount = nothing to check

  const normalizedEmail = normalizeEmail(order.customerEmail);
  const emailHash = hashPII(normalizedEmail);
  const addressHash = hashAddress(order.shippingAddress);

  // Store the order
  await supabase.from("orders").insert({
    shop: order.shop,
    shopify_order_id: order.shopifyOrderId,
    discount_code: order.discountCode,
    customer_email: emailHash,
    customer_ip: order.customerIp ? hashPII(order.customerIp) : null,
    shipping_address_hash: addressHash,
  });

  // Run detection checks in parallel
  await Promise.all([
    checkMultiAccountSameIP(order, emailHash),
    checkMultiAccountSameAddress(order, emailHash, addressHash),
    checkExcessiveUse(order, emailHash),
  ]);
}

// Detection 1: Same discount code used from same IP by different emails
async function checkMultiAccountSameIP(order: OrderData, emailHash: string) {
  if (!order.customerIp) return;
  const ipHash = hashPII(order.customerIp);

  const { data: matches } = await supabase
    .from("orders")
    .select("customer_email")
    .eq("shop", order.shop)
    .eq("discount_code", order.discountCode)
    .eq("customer_ip", ipHash)
    .neq("customer_email", emailHash)
    .limit(5);

  if (matches && matches.length > 0) {
    await flagAbuse({
      shop: order.shop,
      type: "multi_account_same_ip",
      discount_code: order.discountCode,
      severity: matches.length >= 3 ? "high" : "medium",
      resolved: false,
      details: {
        num_accounts: matches.length + 1,
        order_id: order.shopifyOrderId,
        discount_value: order.discountValue,
      },
    });
  }
}

// Detection 2: Same discount code, different emails, same shipping address
async function checkMultiAccountSameAddress(
  order: OrderData,
  emailHash: string,
  addressHash: string | null,
) {
  if (!addressHash) return;

  const { data: matches } = await supabase
    .from("orders")
    .select("customer_email")
    .eq("shop", order.shop)
    .eq("discount_code", order.discountCode)
    .eq("shipping_address_hash", addressHash)
    .neq("customer_email", emailHash)
    .limit(5);

  if (matches && matches.length > 0) {
    await flagAbuse({
      shop: order.shop,
      type: "multi_account_same_address",
      discount_code: order.discountCode,
      severity: matches.length >= 3 ? "high" : "medium",
      resolved: false,
      details: {
        num_accounts: matches.length + 1,
        order_id: order.shopifyOrderId,
        discount_value: order.discountValue,
      },
    });
  }
}

// Detection 3: Same email using same code excessively (>2 times)
async function checkExcessiveUse(order: OrderData, emailHash: string) {
  const { count } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("shop", order.shop)
    .eq("discount_code", order.discountCode)
    .eq("customer_email", emailHash);

  if (count && count > 2) {
    await flagAbuse({
      shop: order.shop,
      type: "excessive_use",
      discount_code: order.discountCode,
      severity: count > 5 ? "high" : "low",
      resolved: false,
      details: {
        uses: count,
        order_id: order.shopifyOrderId,
        discount_value: order.discountValue,
      },
    });
  }
}

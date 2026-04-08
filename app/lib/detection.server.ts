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

// Known disposable/temporary email providers
const DISPOSABLE_EMAIL_DOMAINS = [
  "mailinator.com",
  "guerrillamail.com",
  "tempmail.com",
  "throwaway.email",
  "yopmail.com",
  "sharklasers.com",
  "guerrillamailblock.com",
  "grr.la",
  "dispostable.com",
  "mailnesia.com",
  "maildrop.cc",
  "10minutemail.com",
  "trashmail.com",
  "fakeinbox.com",
  "tempail.com",
  "harakirimail.com",
  "mailcatch.com",
  "temp-mail.org",
  "getnada.com",
  "mohmal.com",
] as const;

export async function analyzeOrder(order: OrderData): Promise<void> {
  if (!order.discountCode) return; // No discount = nothing to check

  const normalizedEmail = normalizeEmail(order.customerEmail);
  const emailHash = hashPII(normalizedEmail);
  const addressHash = hashAddress(order.shippingAddress);

  // Store the order
  try {
    await supabase.from("orders").insert({
      shop: order.shop,
      shopify_order_id: order.shopifyOrderId,
      discount_code: order.discountCode,
      customer_email: emailHash,
      customer_ip: order.customerIp ? hashPII(order.customerIp) : null,
      shipping_address_hash: addressHash,
    });
  } catch (err) {
    console.error("[detection] Failed to insert order:", err);
  }

  // Run detection checks in parallel
  try {
    await Promise.all([
      checkMultiAccountSameIP(order, emailHash),
      checkMultiAccountSameAddress(order, emailHash, addressHash),
      checkExcessiveUse(order, emailHash),
      checkRapidFireUsage(order),
      checkDisposableEmail(order),
      checkEmailPatternAbuse(order, emailHash),
    ]);
  } catch (err) {
    console.error("[detection] Detection checks failed:", err);
  }
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

// Detection 3: Rapid-fire usage — same discount code used by 5+ different customers within 30 minutes
async function checkRapidFireUsage(order: OrderData) {
  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const { count } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("shop", order.shop)
    .eq("discount_code", order.discountCode)
    .gte("created_at", thirtyMinsAgo);

  if (count && count >= 5) {
    await flagAbuse({
      shop: order.shop,
      type: "public_share",
      discount_code: order.discountCode,
      severity: count >= 10 ? "high" : "medium",
      resolved: false,
      details: {
        uses_in_30min: count,
        order_id: order.shopifyOrderId,
        discount_value: order.discountValue,
        likely_cause: "Discount code shared publicly (social media, coupon sites)",
      },
    });
  }
}

// Detection 5: Disposable email provider used with a discount code
async function checkDisposableEmail(order: OrderData) {
  const domain = order.customerEmail.toLowerCase().split("@")[1];
  if (!domain) return;

  if (DISPOSABLE_EMAIL_DOMAINS.includes(domain as (typeof DISPOSABLE_EMAIL_DOMAINS)[number])) {
    await flagAbuse({
      shop: order.shop,
      type: "public_share",
      discount_code: order.discountCode!,
      severity: "medium",
      resolved: false,
      details: {
        email_domain: domain,
        order_id: order.shopifyOrderId,
        discount_value: order.discountValue,
        likely_cause: "Disposable email provider detected",
      },
    });
  }
}

// Detection 4: Same email using same code excessively (>2 times)
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

// Detection 6: Patterned email addresses using the same discount code
// Catches user1@gmail.com, user2@gmail.com, user3@gmail.com style abuse
async function checkEmailPatternAbuse(order: OrderData, emailHash: string) {
  if (!order.discountCode) return;

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // We need raw emails to compare patterns, but we only store hashes.
  // Instead, query recent orders with this discount code and store the current
  // email in a lightweight in-memory cache keyed by shop+discount for comparison.
  // Since we can't reverse hashes, we compare at analysis time using the raw email
  // from the webhook payload. We query distinct email hashes to see volume, then
  // use the raw email from this order to check against a pattern cache.

  // For this detection, we keep a simple module-level cache of recent emails per shop+code.
  const cacheKey = `${order.shop}:${order.discountCode}`;
  if (!emailPatternCache.has(cacheKey)) {
    emailPatternCache.set(cacheKey, []);
  }
  const recentEmails = emailPatternCache.get(cacheKey)!;

  // Add current email and prune entries older than 24h
  const now = Date.now();
  recentEmails.push({ email: order.customerEmail.toLowerCase(), timestamp: now });
  const cutoff = now - 24 * 60 * 60 * 1000;
  const filtered = recentEmails.filter((e) => e.timestamp >= cutoff);
  emailPatternCache.set(cacheKey, filtered);

  if (filtered.length < 3) return;

  // Group by email domain
  const byDomain = new Map<string, string[]>();
  for (const entry of filtered) {
    const [local, domain] = entry.email.split("@");
    if (!local || !domain) continue;
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain)!.push(local);
  }

  for (const [domain, locals] of byDomain) {
    if (locals.length < 3) continue;

    // Check for sequential numbers: extract trailing digits and see if they form a sequence
    const withNumbers = locals
      .map((l) => {
        const match = l.match(/^(.+?)(\d+)$/);
        return match ? { base: match[1], num: parseInt(match[2], 10) } : null;
      })
      .filter(Boolean) as { base: string; num: number }[];

    // Group by base prefix
    const byBase = new Map<string, number[]>();
    for (const { base, num } of withNumbers) {
      if (!byBase.has(base)) byBase.set(base, []);
      byBase.get(base)!.push(num);
    }

    let patternFound = false;

    for (const [, nums] of byBase) {
      if (nums.length >= 3) {
        patternFound = true;
        break;
      }
    }

    // Also check if local parts differ by only 1-2 characters from each other
    if (!patternFound) {
      let similarCount = 0;
      for (let i = 0; i < locals.length && !patternFound; i++) {
        similarCount = 1; // count self
        for (let j = i + 1; j < locals.length; j++) {
          if (levenshteinDistance(locals[i], locals[j]) <= 2) {
            similarCount++;
          }
        }
        if (similarCount >= 3) {
          patternFound = true;
        }
      }
    }

    if (patternFound) {
      await flagAbuse({
        shop: order.shop,
        type: "multi_account_same_ip",
        discount_code: order.discountCode,
        severity: "high",
        resolved: false,
        details: {
          email_domain: domain,
          num_similar_emails: locals.length,
          order_id: order.shopifyOrderId,
          discount_value: order.discountValue,
          likely_cause: "Patterned email addresses detected",
        },
      });
      break; // One flag per order is enough
    }
  }
}

// In-memory cache for recent emails per shop+discount (cleared naturally by 24h window)
const emailPatternCache = new Map<string, { email: string; timestamp: number }[]>();

// Simple Levenshtein distance for short strings
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) matrix[i] = [i];
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

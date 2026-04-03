import type { Session } from "@shopify/shopify-api";
import { shopify } from "./shopify.server";
import { supabase } from "./supabase.server";
import type { AbuseFlag, MerchantSettings } from "./supabase.server";

// Send email alert to merchant via Shopify's notification system
// Uses shop email from Shopify API
export async function sendAbuseAlert(
  session: Session,
  flag: AbuseFlag,
): Promise<void> {
  // Check if merchant has email alerts enabled
  const { data: merchant } = await supabase
    .from("merchants")
    .select("settings")
    .eq("shop", session.shop)
    .single();

  const settings = merchant?.settings as MerchantSettings | null;
  if (!settings?.email_alerts) return;

  // Get shop details for email
  const client = new shopify.clients.Graphql({ session });
  const response = await client.request(`
    query {
      shop {
        email
        name
      }
    }
  `);

  const shop = (response as any)?.data?.shop;
  if (!shop?.email) return;

  // In production, integrate with an email service (Resend, SendGrid, etc.)
  // For now, log the alert
  console.log(`[ALERT] Discount abuse detected for ${session.shop}:`, {
    type: flag.type,
    code: flag.discount_code,
    severity: flag.severity,
    shopEmail: shop.email,
  });

  // TODO: Send actual email via Resend/SendGrid
  // await resend.emails.send({
  //   from: "alerts@discountguard.app",
  //   to: shop.email,
  //   subject: `⚠️ Discount abuse detected: ${flag.discount_code}`,
  //   html: buildAlertEmail(shop.name, flag),
  // });
}

export function buildAlertEmail(shopName: string, flag: AbuseFlag): string {
  const typeLabels: Record<string, string> = {
    multi_account_same_ip: "Multiple accounts using the same discount code from the same IP address",
    multi_account_same_address: "Multiple accounts using the same discount code shipping to the same address",
    excessive_use: "A single customer has used a discount code an unusually high number of times",
    public_share: "A discount code appears to have been shared publicly",
  };

  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #dc2626;">Discount Abuse Detected</h2>
      <p>Hi ${shopName},</p>
      <p>Discount Guard detected potential abuse on your store:</p>
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p><strong>Code:</strong> ${flag.discount_code}</p>
        <p><strong>Type:</strong> ${typeLabels[flag.type] ?? flag.type}</p>
        <p><strong>Severity:</strong> ${flag.severity.toUpperCase()}</p>
      </div>
      <p>View details in your <a href="https://admin.shopify.com/store">Discount Guard dashboard</a>.</p>
      <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
        You're receiving this because you have email alerts enabled in Discount Guard.
      </p>
    </div>
  `;
}

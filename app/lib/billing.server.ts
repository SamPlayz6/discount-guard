import type { Session } from "@shopify/shopify-api";
import { shopify } from "./shopify.server";
import { supabase } from "./supabase.server";

export const PLANS = {
  free: { name: "Free", price: 0, ordersPerMonth: 50 },
  basic: { name: "Basic", price: 19, ordersPerMonth: Infinity },
  pro: { name: "Pro", price: 49, ordersPerMonth: Infinity },
} as const;

export type PlanId = keyof typeof PLANS;

// Check if merchant has an active paid subscription
export async function getActivePlan(session: Session): Promise<PlanId> {
  const client = new shopify.clients.Graphql({ session });

  const response = await client.request(`
    query {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
          lineItems {
            plan {
              pricingDetails {
                ... on AppRecurringPricing {
                  price { amount currencyCode }
                }
              }
            }
          }
        }
      }
    }
  `);

  const subs = (response as any)?.data?.currentAppInstallation?.activeSubscriptions ?? [];
  const active = subs.find((s: any) => s.status === "ACTIVE");

  if (!active) return "free";

  const amount = parseFloat(
    active.lineItems?.[0]?.plan?.pricingDetails?.price?.amount ?? "0",
  );

  if (amount >= 49) return "pro";
  if (amount >= 19) return "basic";
  return "free";
}

// Create a subscription charge via Shopify Billing API
export async function createSubscription(
  session: Session,
  plan: "basic" | "pro",
  returnUrl: string,
): Promise<string> {
  const client = new shopify.clients.Graphql({ session });
  const planDetails = PLANS[plan];

  const response = await client.request(`
    mutation {
      appSubscriptionCreate(
        name: "Discount Guard ${planDetails.name}"
        returnUrl: "${returnUrl}"
        test: ${process.env.NODE_ENV === "development"}
        lineItems: [{
          plan: {
            appRecurringPricingDetails: {
              price: { amount: ${planDetails.price}, currencyCode: "USD" }
              interval: EVERY_30_DAYS
            }
          }
        }]
      ) {
        appSubscription { id }
        confirmationUrl
        userErrors { field message }
      }
    }
  `);

  const data = (response as any)?.data?.appSubscriptionCreate;
  if (data?.userErrors?.length > 0) {
    throw new Error(data.userErrors.map((e: any) => e.message).join(", "));
  }

  // Update plan in Supabase
  await supabase
    .from("merchants")
    .update({ plan })
    .eq("shop", session.shop);

  return data.confirmationUrl;
}

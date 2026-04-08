import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { shopify, sessionStorage } from "~/lib/shopify.server";
import { getOrCreateMerchant } from "~/lib/supabase.server";

export async function loader({ request }: LoaderFunctionArgs) {
  let session;
  try {
    const callbackResponse = await shopify.auth.callback({
      rawRequest: request,
    });
    session = callbackResponse.session;
  } catch (error) {
    console.error("OAuth callback failed:", error);
    // Redirect to Shopify app install flow on auth failure
    const shop = new URL(request.url).searchParams.get("shop");
    if (shop) {
      const authUrl = await shopify.auth.begin({
        shop,
        callbackPath: "/auth/callback",
        isOnline: false,
      });
      return redirect(authUrl);
    }
    throw new Response("Authentication failed. Please try installing the app again.", { status: 401 });
  }

  await sessionStorage.storeSession(session);

  // Create merchant record in Supabase
  await getOrCreateMerchant(session.shop);

  // Register webhooks (non-blocking: log errors but don't fail the install)
  try {
    const client = new shopify.clients.Graphql({ session });
    await client.request(`
      mutation {
        webhookSubscriptionCreate(
          topic: ORDERS_CREATE
          webhookSubscription: {
            callbackUrl: "${process.env.HOST}/webhooks/orders-create"
            format: JSON
          }
        ) {
          webhookSubscription { id }
          userErrors { field message }
        }
      }
    `);
  } catch (error) {
    console.error("Webhook registration failed:", error);
  }

  // Redirect to the app
  const host = new URL(request.url).searchParams.get("host") ?? "";
  return redirect(`/?shop=${session.shop}&host=${host}`);
}

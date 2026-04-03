import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { shopify, sessionStorage } from "~/lib/shopify.server";
import { getOrCreateMerchant } from "~/lib/supabase.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const callbackResponse = await shopify.auth.callback({
    rawRequest: request,
  });

  const { session } = callbackResponse;
  await sessionStorage.storeSession(session);

  // Create merchant record in Supabase
  await getOrCreateMerchant(session.shop);

  // Register webhooks
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

  // Redirect to the app
  const host = new URL(request.url).searchParams.get("host") ?? "";
  return redirect(`/?shop=${session.shop}&host=${host}`);
}

import "@shopify/shopify-api/adapters/node";
import { shopifyApi, LATEST_API_VERSION, Session } from "@shopify/shopify-api";

const isDev = process.env.NODE_ENV === "development";

// Initialize Shopify API
export const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  scopes: [
    "read_orders",
    "read_customers",
    "read_discounts",
    "read_price_rules",
  ],
  hostName: process.env.HOST?.replace(/https?:\/\//, "") ?? "localhost:3000",
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
  logger: { level: isDev ? 1 : 0 },
});

// In-memory session storage (use Supabase in production)
const sessionStore = new Map<string, Session>();

export const sessionStorage = {
  async storeSession(session: Session): Promise<boolean> {
    sessionStore.set(session.id, session);
    return true;
  },
  async loadSession(id: string): Promise<Session | undefined> {
    return sessionStore.get(id);
  },
  async deleteSession(id: string): Promise<boolean> {
    sessionStore.delete(id);
    return true;
  },
  async deleteSessions(ids: string[]): Promise<boolean> {
    ids.forEach((id) => sessionStore.delete(id));
    return true;
  },
  async findSessionsByShop(shop: string): Promise<Session[]> {
    return Array.from(sessionStore.values()).filter(
      (session) => session.shop === shop,
    );
  },
};

// Validate the session and return an authenticated admin client
export async function authenticate(request: Request) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    throw new Response("Missing shop parameter", { status: 400 });
  }

  const sessions = await sessionStorage.findSessionsByShop(shop);
  const session = sessions.find((s) => s.isActive(shopify.config.scopes));

  if (!session) {
    // Redirect to OAuth
    const authUrl = await shopify.auth.begin({
      shop,
      callbackPath: "/auth/callback",
      isOnline: false,
    });
    throw new Response(null, {
      status: 302,
      headers: { Location: authUrl },
    });
  }

  const client = new shopify.clients.Graphql({ session });
  return { session, client, shop };
}

import "@shopify/shopify-api/adapters/node";
import { shopifyApi, LATEST_API_VERSION, Session } from "@shopify/shopify-api";
import { supabase } from "./supabase.server";

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

// Supabase-backed session storage (persistent across restarts)
// Table schema: sessions(id text PK, shop text, data jsonb, expires_at timestamptz)
export const sessionStorage = {
  async storeSession(session: Session): Promise<boolean> {
    const { error } = await supabase
      .from("sessions")
      .upsert({
        id: session.id,
        shop: session.shop,
        data: session.toObject(),
        expires_at: session.expires?.toISOString() ?? null,
      });
    if (error) {
      console.error("Failed to store session:", error.message);
      return false;
    }
    return true;
  },

  async loadSession(id: string): Promise<Session | undefined> {
    const { data, error } = await supabase
      .from("sessions")
      .select("data")
      .eq("id", id)
      .single();
    if (error || !data) return undefined;
    return Session.fromPropertyArray(
      Object.entries(data.data as Record<string, unknown>),
    );
  },

  async deleteSession(id: string): Promise<boolean> {
    const { error } = await supabase
      .from("sessions")
      .delete()
      .eq("id", id);
    return !error;
  },

  async deleteSessions(ids: string[]): Promise<boolean> {
    const { error } = await supabase
      .from("sessions")
      .delete()
      .in("id", ids);
    return !error;
  },

  async findSessionsByShop(shop: string): Promise<Session[]> {
    const { data, error } = await supabase
      .from("sessions")
      .select("data")
      .eq("shop", shop);
    if (error || !data) return [];
    return data.map((row) =>
      Session.fromPropertyArray(
        Object.entries(row.data as Record<string, unknown>),
      ),
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

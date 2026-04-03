import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Database types
export interface Merchant {
  id: string;
  shop: string;
  plan: "free" | "basic" | "pro";
  installed_at: string;
  settings: MerchantSettings;
}

export interface MerchantSettings {
  email_alerts: boolean;
  auto_disable_codes: boolean;
  abuse_threshold: number; // number of flags before alerting
}

export interface OrderRecord {
  id: string;
  shop: string;
  shopify_order_id: string;
  discount_code: string | null;
  customer_email: string;
  customer_ip: string | null;
  shipping_address_hash: string | null;
  created_at: string;
}

export interface AbuseFlag {
  id: string;
  shop: string;
  type: "multi_account_same_ip" | "multi_account_same_address" | "excessive_use" | "public_share";
  discount_code: string;
  details: Record<string, unknown>;
  severity: "low" | "medium" | "high";
  resolved: boolean;
  created_at: string;
}

// Helper functions
export async function getOrCreateMerchant(shop: string): Promise<Merchant> {
  const { data: existing } = await supabase
    .from("merchants")
    .select("*")
    .eq("shop", shop)
    .single();

  if (existing) return existing as Merchant;

  const { data: created, error } = await supabase
    .from("merchants")
    .insert({
      shop,
      plan: "free",
      settings: {
        email_alerts: true,
        auto_disable_codes: false,
        abuse_threshold: 3,
      },
    })
    .select()
    .single();

  if (error) throw error;
  return created as Merchant;
}

export async function recordOrder(order: Omit<OrderRecord, "id">) {
  const { error } = await supabase.from("orders").insert(order);
  if (error) throw error;
}

export async function flagAbuse(flag: Omit<AbuseFlag, "id" | "created_at">) {
  const { error } = await supabase.from("abuse_flags").insert(flag);
  if (error) throw error;
}

export async function getAbuseStats(shop: string) {
  const { data: flags } = await supabase
    .from("abuse_flags")
    .select("*")
    .eq("shop", shop)
    .order("created_at", { ascending: false });

  const { count: totalOrders } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("shop", shop);

  const { count: flaggedOrders } = await supabase
    .from("abuse_flags")
    .select("*", { count: "exact", head: true })
    .eq("shop", shop)
    .eq("resolved", false);

  return {
    flags: flags ?? [],
    totalOrders: totalOrders ?? 0,
    flaggedOrders: flaggedOrders ?? 0,
    // Estimate savings based on flagged discount value
    estimatedSavings: (flags ?? []).reduce((sum, f) => {
      const val = (f.details as Record<string, number>)?.discount_value ?? 0;
      return sum + val;
    }, 0),
  };
}

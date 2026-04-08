import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  AppProvider,
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  DataTable,
  EmptyState,
  Banner,
  Icon,
  Box,
} from "@shopify/polaris";
import { authenticate } from "~/lib/shopify.server";
import { getAbuseStats, getOrCreateMerchant } from "~/lib/supabase.server";
import type { AbuseFlag } from "~/lib/supabase.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { shop } = await authenticate(request);
  const merchant = await getOrCreateMerchant(shop);
  const stats = await getAbuseStats(shop);

  return json({ merchant, stats });
}

function severityBadge(severity: string) {
  switch (severity) {
    case "high":
      return <Badge tone="critical">High</Badge>;
    case "medium":
      return <Badge tone="warning">Medium</Badge>;
    default:
      return <Badge>Low</Badge>;
  }
}

function typeLabel(type: string) {
  switch (type) {
    case "multi_account_same_ip":
      return "Same IP, different accounts";
    case "multi_account_same_address":
      return "Same address, different accounts";
    case "excessive_use":
      return "Excessive code reuse";
    case "public_share":
      return "Code shared publicly";
    default:
      return type;
  }
}

export default function Dashboard() {
  const { merchant, stats } = useLoaderData<typeof loader>();

  const rows = stats.flags.slice(0, 20).map((flag: AbuseFlag) => [
    flag.discount_code,
    typeLabel(flag.type),
    severityBadge(flag.severity),
    new Date(flag.created_at).toLocaleDateString(),
    flag.resolved ? "Resolved" : "Active",
  ]);

  return (
    <AppProvider i18n={{}}>
      <Page title="Discount Guard">
        <Layout>
          {/* Stats cards */}
          <Layout.Section>
            <InlineStack gap="400" wrap={false}>
              <Box width="25%">
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingSm" as="h3">
                      Orders Tracked
                    </Text>
                    <Text variant="heading2xl" as="p">
                      {stats.totalOrders.toLocaleString()}
                    </Text>
                  </BlockStack>
                </Card>
              </Box>
              <Box width="25%">
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingSm" as="h3">
                      Abuse Flags
                    </Text>
                    <Text
                      variant="heading2xl"
                      as="p"
                      tone={stats.flaggedOrders > 0 ? "critical" : undefined}
                    >
                      {stats.flaggedOrders}
                    </Text>
                  </BlockStack>
                </Card>
              </Box>
              <Box width="25%">
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingSm" as="h3">
                      Estimated Savings
                    </Text>
                    <Text variant="heading2xl" as="p" tone="success">
                      ${stats.estimatedSavings.toFixed(2)}
                    </Text>
                  </BlockStack>
                </Card>
              </Box>
              <Box width="25%">
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingSm" as="h3">
                      Plan
                    </Text>
                    <Text variant="heading2xl" as="p">
                      {merchant.plan.charAt(0).toUpperCase() +
                        merchant.plan.slice(1)}
                    </Text>
                  </BlockStack>
                </Card>
              </Box>
            </InlineStack>
          </Layout.Section>

          {/* Savings banner */}
          {stats.estimatedSavings > 0 && (
            <Layout.Section>
              <Banner tone="success">
                <p>
                  Discount Guard has saved your store an estimated{" "}
                  <strong>${stats.estimatedSavings.toFixed(2)}</strong> this
                  month by detecting discount code abuse.
                </p>
              </Banner>
            </Layout.Section>
          )}

          {/* Abuse flags table */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Recent Abuse Flags
                </Text>
                {rows.length === 0 ? (
                  <EmptyState
                    heading="No abuse detected yet"
                    image=""
                  >
                    <p>
                      Discount Guard is monitoring your orders. You'll see
                      flagged activity here when abuse is detected.
                    </p>
                  </EmptyState>
                ) : (
                  <DataTable
                    columnContentTypes={[
                      "text",
                      "text",
                      "text",
                      "text",
                      "text",
                    ]}
                    headings={[
                      "Discount Code",
                      "Type",
                      "Severity",
                      "Date",
                      "Status",
                    ]}
                    rows={rows}
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* How it works */}
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">
                  How Discount Guard Works
                </Text>
                <Text as="p">
                  Every time an order with a discount code comes in, we check
                  for:
                </Text>
                <BlockStack gap="100">
                  <Text as="p">
                    <strong>Same IP, different accounts</strong> — Multiple
                    emails using the same code from the same IP
                  </Text>
                  <Text as="p">
                    <strong>Same address, different accounts</strong> — Different
                    customers shipping to the same address with the same code
                  </Text>
                  <Text as="p">
                    <strong>Rapid-fire usage</strong> — 5+ uses of the same code
                    within 30 minutes (likely shared publicly)
                  </Text>
                  <Text as="p">
                    <strong>Excessive reuse</strong> — One customer using a
                    single-use code multiple times
                  </Text>
                  <Text as="p">
                    <strong>Disposable emails</strong> — Orders using temporary
                    email providers (mailinator, guerrillamail, etc.)
                  </Text>
                  <Text as="p">
                    <strong>Patterned emails</strong> — Sequential or near-identical
                    email addresses (user1@, user2@, user3@)
                  </Text>
                </BlockStack>
                <Text as="p" tone="subdued">
                  All data is hashed for privacy. We never store raw email
                  addresses or IP addresses.
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </AppProvider>
  );
}

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, Form } from "@remix-run/react";
import {
  AppProvider,
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  List,
  Divider,
  Box,
} from "@shopify/polaris";
import { authenticate } from "~/lib/shopify.server";
import { getActivePlan, createSubscription, PLANS } from "~/lib/billing.server";
import { getOrCreateMerchant } from "~/lib/supabase.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, shop } = await authenticate(request);
  const currentPlan = await getActivePlan(session);
  const merchant = await getOrCreateMerchant(shop);
  return json({ currentPlan, merchant });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, shop } = await authenticate(request);
  const formData = await request.formData();
  const plan = formData.get("plan") as "basic" | "pro";

  if (plan !== "basic" && plan !== "pro") {
    return json({ error: "Invalid plan" }, { status: 400 });
  }

  const host = new URL(request.url).searchParams.get("host") ?? "";
  const returnUrl = `${process.env.HOST}/?shop=${shop}&host=${host}`;
  const confirmationUrl = await createSubscription(session, plan, returnUrl);

  return redirect(confirmationUrl);
}

export default function Billing() {
  const { currentPlan } = useLoaderData<typeof loader>();

  return (
    <AppProvider i18n={{}}>
      <Page title="Plans & Pricing" backAction={{ url: "/" }}>
        <Layout>
          <Layout.Section>
            <InlineStack gap="400" wrap={false} align="center">
              {/* Free Plan */}
              <Box width="33%">
                <Card>
                  <BlockStack gap="400">
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text variant="headingMd" as="h2">Free</Text>
                        {currentPlan === "free" && <Badge tone="info">Current</Badge>}
                      </InlineStack>
                      <Text variant="heading2xl" as="p">$0<Text as="span" variant="bodySm">/mo</Text></Text>
                    </BlockStack>
                    <Divider />
                    <List>
                      <List.Item>Up to 50 orders/month</List.Item>
                      <List.Item>Basic abuse detection</List.Item>
                      <List.Item>Dashboard access</List.Item>
                    </List>
                  </BlockStack>
                </Card>
              </Box>

              {/* Basic Plan */}
              <Box width="33%">
                <Card background="bg-surface-secondary">
                  <BlockStack gap="400">
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text variant="headingMd" as="h2">Basic</Text>
                        {currentPlan === "basic" && <Badge tone="info">Current</Badge>}
                      </InlineStack>
                      <Text variant="heading2xl" as="p">$19<Text as="span" variant="bodySm">/mo</Text></Text>
                    </BlockStack>
                    <Divider />
                    <List>
                      <List.Item>Unlimited orders</List.Item>
                      <List.Item>Email alerts</List.Item>
                      <List.Item>All detection methods</List.Item>
                      <List.Item>Monthly savings report</List.Item>
                    </List>
                    {currentPlan === "free" && (
                      <Form method="post">
                        <input type="hidden" name="plan" value="basic" />
                        <Button variant="primary" submit fullWidth>
                          Upgrade to Basic
                        </Button>
                      </Form>
                    )}
                  </BlockStack>
                </Card>
              </Box>

              {/* Pro Plan */}
              <Box width="33%">
                <Card>
                  <BlockStack gap="400">
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text variant="headingMd" as="h2">Pro</Text>
                        {currentPlan === "pro" && <Badge tone="info">Current</Badge>}
                      </InlineStack>
                      <Text variant="heading2xl" as="p">$49<Text as="span" variant="bodySm">/mo</Text></Text>
                    </BlockStack>
                    <Divider />
                    <List>
                      <List.Item>Everything in Basic</List.Item>
                      <List.Item>Auto-disable abused codes</List.Item>
                      <List.Item>Advanced fingerprinting</List.Item>
                      <List.Item>Analytics & trends</List.Item>
                      <List.Item>Priority support</List.Item>
                    </List>
                    {currentPlan !== "pro" && (
                      <Form method="post">
                        <input type="hidden" name="plan" value="pro" />
                        <Button variant="primary" submit fullWidth>
                          Upgrade to Pro
                        </Button>
                      </Form>
                    )}
                  </BlockStack>
                </Card>
              </Box>
            </InlineStack>
          </Layout.Section>
        </Layout>
      </Page>
    </AppProvider>
  );
}

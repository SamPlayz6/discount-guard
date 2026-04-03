import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Form, useNavigation } from "@remix-run/react";
import {
  AppProvider,
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  Checkbox,
  TextField,
  Button,
  Banner,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "~/lib/shopify.server";
import { getOrCreateMerchant, supabase } from "~/lib/supabase.server";
import type { MerchantSettings } from "~/lib/supabase.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { shop } = await authenticate(request);
  const merchant = await getOrCreateMerchant(shop);
  return json({ merchant });
}

export async function action({ request }: ActionFunctionArgs) {
  const { shop } = await authenticate(request);
  const formData = await request.formData();

  const settings: MerchantSettings = {
    email_alerts: formData.get("email_alerts") === "on",
    auto_disable_codes: formData.get("auto_disable_codes") === "on",
    abuse_threshold: parseInt(formData.get("abuse_threshold") as string) || 3,
  };

  const { error } = await supabase
    .from("merchants")
    .update({ settings })
    .eq("shop", shop);

  if (error) {
    return json({ success: false, error: error.message });
  }

  return json({ success: true });
}

export default function Settings() {
  const { merchant } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const settings = merchant.settings as MerchantSettings;
  const [emailAlerts, setEmailAlerts] = useState(settings.email_alerts);
  const [autoDisable, setAutoDisable] = useState(settings.auto_disable_codes);
  const [threshold, setThreshold] = useState(String(settings.abuse_threshold));

  return (
    <AppProvider i18n={{}}>
      <Page title="Settings" backAction={{ url: "/" }}>
        <Layout>
          <Layout.Section>
            <Form method="post">
              <BlockStack gap="400">
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h2">Notifications</Text>
                    <Checkbox
                      label="Email alerts when abuse is detected"
                      checked={emailAlerts}
                      onChange={setEmailAlerts}
                      name="email_alerts"
                    />
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h2">Detection</Text>
                    <TextField
                      label="Abuse threshold"
                      type="number"
                      value={threshold}
                      onChange={setThreshold}
                      name="abuse_threshold"
                      helpText="Number of flags before sending an alert"
                      autoComplete="off"
                    />
                    <Checkbox
                      label="Auto-disable codes when high severity abuse is detected"
                      checked={autoDisable}
                      onChange={setAutoDisable}
                      name="auto_disable_codes"
                      helpText="Pro plan only. Automatically disables discount codes that are being heavily abused."
                    />
                    {autoDisable && merchant.plan !== "pro" && (
                      <Banner tone="warning">
                        Auto-disable requires the Pro plan ($49/mo).
                      </Banner>
                    )}
                  </BlockStack>
                </Card>

                <Button variant="primary" submit loading={isSubmitting}>
                  Save settings
                </Button>
              </BlockStack>
            </Form>
          </Layout.Section>
        </Layout>
      </Page>
    </AppProvider>
  );
}

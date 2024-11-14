import SettingsForm from "./SettingsForm";
import { getConfig } from "@/lib/settings";
import { getAuthConfig } from "@/lib/auth";

export default async function SettingsPage() {
  const [settings, authConfig] = await Promise.all([
    getConfig(),
    getAuthConfig(),
  ]);

  return (
    <SettingsForm
      initialSettings={settings}
      initialApiKey={authConfig.apiKey}
    />
  );
}

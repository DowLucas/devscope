import { useLocation } from "wouter";
import { AccountView } from "@daveyplate/better-auth-ui";
import { ApiKeysCard } from "./ApiKeysCard";

export function SettingsPage() {
  const [location] = useLocation();

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <AccountView pathname={location} />
      <ApiKeysCard />
    </div>
  );
}

import { useLocation } from "wouter";
import { AccountView } from "@daveyplate/better-auth-ui";

export function SettingsPage() {
  const [location] = useLocation();

  return (
    <div className="max-w-2xl mx-auto">
      <AccountView pathname={location} />
    </div>
  );
}

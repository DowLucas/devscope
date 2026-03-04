import { useLocation } from "wouter";
import { AccountView } from "@daveyplate/better-auth-ui";
import { KeyRound, User, Eye } from "lucide-react";
import { ApiKeysCard } from "./ApiKeysCard";
import { DataSharingCard } from "./DataSharingCard";
import { DeleteAccountCard } from "./DeleteAccountCard";

const SECTIONS = [
  { id: "account", label: "Account", icon: User },
  { id: "api-keys", label: "API Keys", icon: KeyRound },
  { id: "privacy", label: "Data Sharing", icon: Eye },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function getSectionFromPath(path: string): SectionId {
  if (path.includes("/api-keys")) return "api-keys";
  if (path.includes("/privacy")) return "privacy";
  return "account";
}

export function SettingsPage() {
  const [location, setLocation] = useLocation();
  const active = getSectionFromPath(location);

  function navigate(id: SectionId) {
    if (id === "account") setLocation("/dashboard/account");
    else setLocation(`/dashboard/account/${id}`);
  }

  return (
    <div className="flex gap-8">
      {/* Sidebar */}
      <nav className="w-44 shrink-0 space-y-1">
        <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
          Settings
        </p>
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => navigate(id)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
              active === id
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-6">
        {active === "account" && (
          <>
            <AccountView pathname={location} />
            <DeleteAccountCard />
          </>
        )}
        {active === "api-keys" && <ApiKeysCard />}
        {active === "privacy" && <DataSharingCard />}
      </div>
    </div>
  );
}

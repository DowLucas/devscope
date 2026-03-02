import { type ReactNode, useEffect } from "react";
import { useLocation } from "wouter";
import { authClient } from "@/lib/auth-client";
import { useListApiKeys } from "@/components/AuthProvider";
import { useTeamStore } from "@/stores/teamStore";
import { useTeamInit } from "@/hooks/useTeam";

export function AuthGuard({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  const { refetch } = useListApiKeys();
  const { currentTeam, loading: teamLoading } = useTeamStore();
  const [location, setLocation] = useLocation();

  useTeamInit();

  // Refetch API keys when navigating back from onboarding
  useEffect(() => {
    if (session && location.startsWith("/dashboard")) {
      refetch();
    }
  }, [session, location, refetch]);

  useEffect(() => {
    if (!isPending && !session && !location.startsWith("/auth/")) {
      setLocation("/auth/sign-in");
    }
  }, [isPending, session, location, setLocation]);

  // Auto-redirect to onboarding if user has no team
  useEffect(() => {
    if (
      !isPending &&
      session &&
      !teamLoading &&
      !currentTeam &&
      !location.startsWith("/onboarding") &&
      !location.startsWith("/auth/") &&
      !location.startsWith("/invite")
    ) {
      setLocation("/onboarding");
    }
  }, [isPending, session, teamLoading, currentTeam, location, setLocation]);

  // Note: API key setup is optional — users can skip it during onboarding
  // and set it up later from Settings. No forced redirect here.

  if (isPending || (session && teamLoading)) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!session && !location.startsWith("/auth/")) {
    return null;
  }

  return <>{children}</>;
}

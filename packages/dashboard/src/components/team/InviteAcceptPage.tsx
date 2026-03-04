import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import logoFull from "@/assets/logo-full.png";

type AcceptStatus = "checking" | "accepting" | "error";

export function InviteAcceptPage({ token }: { token: string }) {
  const [status, setStatus] = useState<AcceptStatus>("checking");
  const [error, setError] = useState("");
  const [, setLocation] = useLocation();
  const acceptingRef = useRef(false);

  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (isPending) return;

    if (!session) {
      sessionStorage.setItem("devscope_invite_token", token);
      setLocation("/auth/sign-up");
      return;
    }

    if (acceptingRef.current) return;
    acceptingRef.current = true;

    authClient.organization
      .acceptInvitation({ invitationId: token })
      .then(() => {
        sessionStorage.removeItem("devscope_invite_token");
        setLocation("/onboarding");
      })
      .catch((err: unknown) => {
        setStatus("error");
        setError(
          err instanceof Error ? err.message : "Failed to accept invitation"
        );
      });
  }, [isPending, session, token, setLocation]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
      <div className="mb-8 text-center flex flex-col items-center gap-2">
        <img src={logoFull} alt="DevScope" className="h-7" />
        <p className="text-muted-foreground text-sm">AI Development Insights</p>
      </div>
      <div className="w-full max-w-md">
        <Card>
          <CardContent className="py-8">
            {status !== "error" && (
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
                <p className="text-sm font-medium">
                  {!session || isPending
                    ? "Checking session..."
                    : "Accepting invitation..."}
                </p>
              </div>
            )}

            {status === "error" && (
              <div className="flex flex-col items-center gap-3 text-center">
                <XCircle className="h-8 w-8 text-destructive" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-destructive">
                    Could not accept invitation
                  </p>
                  <p className="text-xs text-muted-foreground">{error}</p>
                </div>
                <button
                  onClick={() => setLocation("/auth/sign-in")}
                  className="mt-2 inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm hover:bg-accent"
                >
                  Go to Sign In
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

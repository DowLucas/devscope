import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Mail, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import logoFull from "@/assets/logo-full.png";

type AcceptStatus = "checking" | "accepting" | "error" | "unverified";

export function InviteAcceptPage({ token }: { token: string }) {
  const [status, setStatus] = useState<AcceptStatus>("checking");
  const [error, setError] = useState("");
  const [, setLocation] = useLocation();
  const acceptingRef = useRef(false);
  const [resending, setResending] = useState(false);

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
      .then((res) => {
        const err = (res as { error?: { code?: string; message?: string } | null })?.error;
        if (err) {
          if (err.code === "EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION") {
            // Keep the token so the invite survives the verify round-trip
            sessionStorage.setItem("devscope_invite_token", token);
            setStatus("unverified");
          } else {
            setStatus("error");
            setError(err.message || "Failed to accept invitation");
          }
          return;
        }
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

  async function handleResend() {
    if (!session?.user.email) return;
    setResending(true);
    try {
      const res = await authClient.sendVerificationEmail({
        email: session.user.email,
        callbackURL: `${window.location.origin}/invite/${token}`,
      });
      if (res.error) throw new Error(res.error.message);
      toast.success("Verification email sent. Check your spam or junk folder if you don't see it.");
    } catch {
      toast.error("Could not send the verification email. Please try again shortly.");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
      <div className="mb-8 text-center flex flex-col items-center gap-2">
        <img src={logoFull} alt="DevScope" className="h-7" />
        <p className="text-muted-foreground text-sm">AI Development Insights</p>
      </div>
      <div className="w-full max-w-md">
        <Card>
          <CardContent className="py-8">
            {status !== "error" && status !== "unverified" && (
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
                <p className="text-sm font-medium">
                  {!session || isPending
                    ? "Checking session..."
                    : "Accepting invitation..."}
                </p>
              </div>
            )}

            {status === "unverified" && (
              <div className="flex flex-col items-center gap-3 text-center">
                <Mail className="h-8 w-8 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">Verify your email to join</p>
                  <p className="text-xs text-muted-foreground">
                    We sent a verification link to {session?.user.email}. If you don't see it
                    within a few minutes, check your spam or junk folder. After verifying,
                    you'll return here to accept the invitation.
                  </p>
                </div>
                <button
                  onClick={handleResend}
                  disabled={resending}
                  className="mt-2 inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
                >
                  {resending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Resend verification email
                </button>
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

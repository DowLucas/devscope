import { useState, useEffect } from "react";
import { Key, Copy, Check, Terminal, Loader2, CheckCircle2, XCircle, ArrowRight, Users, UserPlus, Mail, SkipForward } from "lucide-react";
import { useTeamStore } from "@/stores/teamStore";
import { motion, AnimatePresence } from "motion/react";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { authClient } from "@/lib/auth-client";
import { apiFetch } from "@/lib/api";
import { InviteDialog } from "@/components/team/InviteDialog";

const INSTALL_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/DowLucas/devscope-plugin/main/install.sh | bash";

const EASE_CURVE = [0.25, 0.46, 0.45, 0.94] as const;

const sectionVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: 0.15 * i, ease: EASE_CURVE },
  }),
};

const revealVariants = {
  hidden: { opacity: 0, height: 0 },
  visible: {
    opacity: 1,
    height: "auto",
    transition: { duration: 0.4, ease: EASE_CURVE },
  },
};

type VerifyStatus = "idle" | "loading" | "success" | "error";

export function OnboardingWizard() {
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [keyName, setKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [cmdCopied, setCmdCopied] = useState(false);
  const [installKeyCopied, setInstallKeyCopied] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>("idle");
  const [verifyError, setVerifyError] = useState("");
  const [, setLocation] = useLocation();

  const [teamStep, setTeamStep] = useState<"pending" | "creating" | "done">("pending");
  const [teamName, setTeamName] = useState("");
  const { currentTeam, setCurrentTeam, setCurrentRole } = useTeamStore();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitesSent, setInvitesSent] = useState(0);

  const inviteToken = sessionStorage.getItem("devscope_invite_token");

  // Skip team step if already in a team
  useEffect(() => {
    if (currentTeam && teamStep === "pending") {
      setTeamStep("done");
    }
  }, [currentTeam, teamStep]);

  // Auto-accept invitation if invite token exists
  useEffect(() => {
    if (!inviteToken || teamStep !== "pending" || currentTeam) return;

    setTeamStep("creating");
    authClient.organization
      .acceptInvitation({ invitationId: inviteToken })
      .then(async () => {
        sessionStorage.removeItem("devscope_invite_token");
        // Set the joined org as active and populate the store
        try {
          const listRes = await authClient.organization.list();
          const orgs = (listRes as any)?.data;
          if (orgs && orgs.length > 0) {
            const org = orgs[0];
            await authClient.organization.setActive({ organizationId: org.id });
            setCurrentTeam({ id: org.id, name: org.name, slug: org.slug, logo: org.logo ?? null });
            setCurrentRole("member");
          }
        } catch {
          // Non-critical — useTeamInit will pick it up on next render
        }
        try {
          await apiFetch("/api/teams/link-developer", { method: "POST" });
        } catch {
          // Non-critical — developer link can be retried
        }
        setTeamStep("done");
        toast.success("Joined team successfully");
      })
      .catch(() => {
        sessionStorage.removeItem("devscope_invite_token");
        toast.error("Failed to accept invitation. You can create a new team instead.");
        setTeamStep("pending");
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreateTeam() {
    if (!teamName.trim()) return;
    setTeamStep("creating");
    try {
      const slug = teamName.trim().toLowerCase().replace(/\s+/g, "-");
      const res = await authClient.organization.create({
        name: teamName.trim(),
        slug,
      });
      const org = (res as any)?.data;
      if (org?.id) {
        // Set as active so the session carries the org context
        await authClient.organization.setActive({ organizationId: org.id });
        // Populate teamStore so AuthGuard won't redirect back
        setCurrentTeam({ id: org.id, name: org.name, slug: org.slug, logo: org.logo ?? null });
        setCurrentRole("owner");
      }
      try {
        await apiFetch("/api/teams/link-developer", { method: "POST" });
      } catch {
        // Non-critical
      }
      setTeamStep("done");
      toast.success("Team created");
    } catch {
      toast.error("Failed to create team");
      setTeamStep("pending");
    }
  }

  const serverUrl = import.meta.env.VITE_API_BASE_URL ||
    (import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:6767` : window.location.origin);

  async function handleCreateKey() {
    setCreating(true);
    try {
      const res = await authClient.apiKey.create({ name: keyName || undefined });
      const key = (res as any)?.data?.key;
      if (!key) throw new Error("No key returned");
      setGeneratedKey(key);
    } catch {
      toast.error("Failed to create API key");
    } finally {
      setCreating(false);
    }
  }

  async function handleCopyKey() {
    if (!generatedKey) return;
    await navigator.clipboard.writeText(generatedKey);
    setKeyCopied(true);
    toast.success("API key copied to clipboard");
  }

  async function handleCopyCommand() {
    await navigator.clipboard.writeText(INSTALL_COMMAND);
    setCmdCopied(true);
    toast.success("Install command copied");
    setTimeout(() => setCmdCopied(false), 2000);
  }

  async function handleCopyInstallKey() {
    if (!generatedKey) return;
    await navigator.clipboard.writeText(generatedKey);
    setInstallKeyCopied(true);
    toast.success("API key copied");
    setTimeout(() => setInstallKeyCopied(false), 2000);
  }

  async function handleVerify() {
    if (!generatedKey) return;
    setVerifyStatus("loading");
    setVerifyError("");
    try {
      const res = await apiFetch("/api/verify-connection", {
        method: "POST",
        headers: { "x-api-key": generatedKey },
      });
      const data = await res.json();
      if (data.valid) {
        setVerifyStatus("success");
      } else {
        setVerifyStatus("error");
        setVerifyError(data.error || "Verification failed");
      }
    } catch {
      setVerifyStatus("error");
      setVerifyError("Could not reach the server");
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-16 space-y-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="text-center space-y-2"
        >
          <h1 className="text-3xl font-bold tracking-tight">Welcome to DevScope</h1>
          <p className="text-muted-foreground">
            Follow these steps to connect your Claude Code sessions to DevScope.
          </p>
        </motion.div>

        {/* Step 0: Team Setup */}
        {teamStep !== "done" && (
          <motion.div custom={0} variants={sectionVariants} initial="hidden" animate="visible">
            <Card>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                  <StepNumber n={1} done={false} />
                  <div className="space-y-1 pt-0.5">
                    <h2 className="text-lg font-semibold">Set Up Your Team</h2>
                    <p className="text-sm text-muted-foreground">
                      Create a team to organize your developers and sessions.
                    </p>
                  </div>
                </div>

                <div className="ml-10 space-y-3">
                  {teamStep === "creating" ? (
                    <div className="flex items-center gap-2 text-muted-foreground py-2">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span className="text-sm">
                        {inviteToken ? "Joining team..." : "Creating team..."}
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <label htmlFor="team-name" className="text-sm font-medium">
                          Team name
                        </label>
                        <input
                          id="team-name"
                          type="text"
                          placeholder="e.g. My Company"
                          value={teamName}
                          onChange={(e) => setTeamName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleCreateTeam();
                          }}
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                      <motion.button
                        onClick={handleCreateTeam}
                        disabled={!teamName.trim()}
                        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.97 }}
                      >
                        <Users className="h-4 w-4" />
                        Create Team
                      </motion.button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Steps after team setup */}
        {teamStep === "done" && (
        <>
        {/* Step 2: Invite Team Members */}
        <motion.div custom={0} variants={sectionVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <StepNumber n={2} done={invitesSent > 0} />
                <div className="space-y-1 pt-0.5">
                  <h2 className="text-lg font-semibold">Invite Team Members</h2>
                  <p className="text-sm text-muted-foreground">
                    Add developers to your team to share insights and collaborate.
                  </p>
                </div>
              </div>

              <div className="ml-10 space-y-3">
                {invitesSent > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400"
                  >
                    <Mail className="h-4 w-4" />
                    {invitesSent} invite{invitesSent !== 1 ? "s" : ""} sent
                  </motion.div>
                )}
                <motion.button
                  onClick={() => setInviteOpen(true)}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <UserPlus className="h-4 w-4" />
                  {invitesSent > 0 ? "Invite Another" : "Invite a Developer"}
                </motion.button>
                <p className="text-xs text-muted-foreground">
                  They'll receive an email with a link to join your team. You can also invite members later from the Team page.
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <InviteDialog
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          onInvited={() => setInvitesSent((n) => n + 1)}
        />

        {/* Step 3: Create API Key */}
        <motion.div custom={1} variants={sectionVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <StepNumber n={3} done={!!generatedKey && keyCopied} />
                <div className="space-y-1 pt-0.5">
                  <h2 className="text-lg font-semibold">Create an API Key</h2>
                  <p className="text-sm text-muted-foreground">
                    Your plugin uses this key to authenticate with the DevScope server.
                  </p>
                </div>
              </div>

              <AnimatePresence mode="wait">
                {!generatedKey ? (
                  <motion.div
                    key="create-form"
                    initial={{ opacity: 1 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                    className="ml-10 space-y-3"
                  >
                    <div className="space-y-1.5">
                      <label htmlFor="key-name" className="text-sm font-medium">
                        Key name <span className="text-muted-foreground">(optional)</span>
                      </label>
                      <input
                        id="key-name"
                        type="text"
                        placeholder="e.g. My Laptop"
                        value={keyName}
                        onChange={(e) => setKeyName(e.target.value)}
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <motion.button
                      onClick={handleCreateKey}
                      disabled={creating}
                      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.97 }}
                    >
                      {creating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Key className="h-4 w-4" />
                      )}
                      Generate API Key
                    </motion.button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="key-display"
                    variants={revealVariants}
                    initial="hidden"
                    animate="visible"
                    className="ml-10 space-y-3 overflow-hidden"
                  >
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Your API Key</label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 rounded-md border bg-muted px-3 py-2 text-sm font-mono break-all">
                          {generatedKey}
                        </code>
                        <motion.button
                          onClick={handleCopyKey}
                          className="shrink-0 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-accent"
                          whileTap={{ scale: 0.95 }}
                        >
                          <AnimatePresence mode="wait" initial={false}>
                            {keyCopied ? (
                              <motion.span
                                key="copied"
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                className="flex items-center gap-1.5"
                              >
                                <Check className="h-4 w-4 text-green-500" /> Copied
                              </motion.span>
                            ) : (
                              <motion.span
                                key="copy"
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                className="flex items-center gap-1.5"
                              >
                                <Copy className="h-4 w-4" /> Copy
                              </motion.span>
                            )}
                          </AnimatePresence>
                        </motion.button>
                      </div>
                    </div>
                    <p className="text-sm text-amber-500 dark:text-amber-400">
                      This key is only shown once. Make sure to copy it before continuing.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        </motion.div>

        {/* Step 4: Install Plugin */}
        <motion.div custom={2} variants={sectionVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <StepNumber n={4} />
                <div className="space-y-1 pt-0.5">
                  <h2 className="text-lg font-semibold">Install the Plugin</h2>
                  <p className="text-sm text-muted-foreground">
                    Run this command in your terminal to install the DevScope Claude Code plugin.
                  </p>
                </div>
              </div>

              <div className="ml-10 space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <Terminal className="h-4 w-4" />
                    Install command
                  </label>
                  <div className="flex items-start gap-2">
                    <code className="flex-1 rounded-md border bg-muted px-3 py-2 text-sm font-mono break-all">
                      {INSTALL_COMMAND}
                    </code>
                    <motion.button
                      onClick={handleCopyCommand}
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-accent"
                      whileTap={{ scale: 0.95 }}
                    >
                      {cmdCopied ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </motion.button>
                  </div>
                </div>

                <div className="rounded-md border bg-muted/50 p-4 space-y-3 text-sm">
                  <p className="font-medium">When the installer prompts you, enter:</p>
                  <div className="space-y-2">
                    <div>
                      <span className="text-muted-foreground">Server URL:</span>{" "}
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{serverUrl}</code>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">API Key:</span>{" "}
                      {generatedKey ? (
                        <>
                          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs truncate max-w-48">
                            {generatedKey.slice(0, 16)}...
                          </code>
                          <button
                            onClick={handleCopyInstallKey}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            {installKeyCopied ? (
                              <Check className="h-3 w-3 text-green-500" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                            {installKeyCopied ? "Copied" : "Copy key"}
                          </button>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Generate a key in step 3 first</span>
                      )}
                    </div>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  The installer registers DevScope as a Claude Code plugin with session hooks.
                  It runs non-blocking and won't affect your Claude Code sessions.
                </p>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Step 5: Verify Connection */}
        <motion.div custom={3} variants={sectionVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <StepNumber n={5} done={verifyStatus === "success"} />
                <div className="space-y-1 pt-0.5">
                  <h2 className="text-lg font-semibold">Verify Connection</h2>
                  <p className="text-sm text-muted-foreground">
                    Test that your API key works by verifying it against the server.
                  </p>
                </div>
              </div>

              <div className="ml-10">
                <AnimatePresence mode="wait">
                  {verifyStatus === "idle" && (
                    <motion.div
                      key="idle"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      <motion.button
                        onClick={handleVerify}
                        disabled={!generatedKey}
                        className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        whileHover={generatedKey ? { scale: 1.02 } : undefined}
                        whileTap={generatedKey ? { scale: 0.97 } : undefined}
                      >
                        Test Connection
                      </motion.button>
                      {!generatedKey && (
                        <p className="text-xs text-muted-foreground mt-2">Generate an API key first.</p>
                      )}
                    </motion.div>
                  )}

                  {verifyStatus === "loading" && (
                    <motion.div
                      key="loading"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-2 text-muted-foreground py-2"
                    >
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span className="text-sm">Verifying...</span>
                    </motion.div>
                  )}

                  {verifyStatus === "success" && (
                    <motion.div
                      key="success"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ type: "spring", stiffness: 300, damping: 24 }}
                      className="space-y-4"
                    >
                      <div className="flex items-center gap-2 text-green-500">
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: "spring", stiffness: 400, damping: 15, delay: 0.1 }}
                        >
                          <CheckCircle2 className="h-6 w-6" />
                        </motion.div>
                        <span className="font-medium">Connection verified!</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Your plugin is ready to send events to DevScope.
                      </p>
                      <motion.button
                        onClick={() => setLocation("/dashboard")}
                        className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.97 }}
                      >
                        Go to Dashboard
                        <ArrowRight className="h-4 w-4" />
                      </motion.button>
                    </motion.div>
                  )}

                  {verifyStatus === "error" && (
                    <motion.div
                      key="error"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="space-y-3"
                    >
                      <div className="flex items-center gap-2 text-destructive">
                        <XCircle className="h-5 w-5" />
                        <span className="text-sm font-medium">{verifyError}</span>
                      </div>
                      <motion.button
                        onClick={handleVerify}
                        className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm hover:bg-accent"
                        whileTap={{ scale: 0.97 }}
                      >
                        Try Again
                      </motion.button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Skip setup link */}
        <motion.div custom={4} variants={sectionVariants} initial="hidden" animate="visible">
          <div className="text-center">
            <button
              onClick={() => setLocation("/dashboard")}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <SkipForward className="h-4 w-4" />
              Skip setup and go to dashboard
            </button>
            <p className="text-xs text-muted-foreground mt-1">
              You can set up API keys and install the plugin later from Settings.
            </p>
          </div>
        </motion.div>
        </>
        )}
      </div>
    </div>
  );
}

function StepNumber({ n, done }: { n: number; done?: boolean }) {
  return (
    <motion.div
      layout
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium mt-0.5 ${
        done ? "bg-green-500 text-white" : "bg-primary text-primary-foreground"
      }`}
    >
      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.span
            key="check"
            initial={{ scale: 0, rotate: -90 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
          >
            <Check className="h-3.5 w-3.5" />
          </motion.span>
        ) : (
          <motion.span
            key={`n-${n}`}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
          >
            {n}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Mail, Trash2, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";

interface LinkedDeveloper {
  developer_id: string;
  name: string;
  email: string;
}

interface ErrorBody {
  error?: string;
}

export function LinkedEmailsCard() {
  const [developers, setDevelopers] = useState<LinkedDeveloper[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [linking, setLinking] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

  const { data: session } = authClient.useSession();
  const { data: activeOrg } = authClient.useActiveOrganization();
  const primaryEmail = session?.user?.email ?? "";
  const activeOrgId = activeOrg?.id ?? null;

  const fetchLinked = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/teams/my-linked-developers");
      if (!res.ok) {
        const body: ErrorBody = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to load linked emails");
      }
      const data = (await res.json()) as LinkedDeveloper[];
      setDevelopers(data);
    } catch (err) {
      console.error("fetchLinked failed:", err);
      setDevelopers([]);
      setError(err instanceof Error ? err.message : "Failed to load linked emails");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeOrgId) return;
    fetchLinked();
  }, [activeOrgId, fetchLinked]);

  async function handleLink() {
    const trimmed = email.trim();
    if (!trimmed) return;
    setLinking(true);
    try {
      const res = await apiFetch("/api/teams/link-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = (await res.json()) as { developer_id?: string; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Failed to link email");
        return;
      }
      toast.success("Email linked successfully");
      setEmail("");
      await fetchLinked();
    } catch {
      toast.error("Failed to link email");
    } finally {
      setLinking(false);
    }
  }

  async function handleUnlink(developerId: string) {
    setUnlinkingId(developerId);
    try {
      const res = await apiFetch("/api/teams/unlink-email", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ developer_id: developerId }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Failed to unlink email");
        return;
      }
      toast.success("Email unlinked");
      await fetchLinked();
    } catch {
      toast.error("Failed to unlink email");
    } finally {
      setUnlinkingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-4 w-4" />
          Linked Git Emails
        </CardTitle>
        <CardDescription>
          Link additional git emails to your account so sessions from all your
          identities are aggregated together.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading linked emails…
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <ul className="space-y-2">
            {developers.map((dev) => {
              const isPrimary = dev.email.toLowerCase() === primaryEmail.toLowerCase();
              return (
                <li
                  key={dev.developer_id}
                  className="flex items-center justify-between rounded-lg border px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{dev.email}</p>
                      {dev.name && (
                        <p className="text-xs text-muted-foreground truncate">{dev.name}</p>
                      )}
                    </div>
                    {isPrimary && (
                      <span className="ml-1 shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        primary
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleUnlink(dev.developer_id)}
                    disabled={isPrimary || unlinkingId === dev.developer_id}
                    title={isPrimary ? "Cannot unlink your primary email" : "Unlink email"}
                    className="ml-3 flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
                  >
                    {unlinkingId === dev.developer_id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    Unlink
                  </button>
                </li>
              );
            })}
            {developers.length === 0 && (
              <li className="text-sm text-muted-foreground">No linked emails yet.</li>
            )}
          </ul>
        )}

        {/* Add email */}
        <div className="flex gap-2 pt-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLink()}
            placeholder="git-email@example.com"
            className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={handleLink}
            disabled={linking || !email.trim()}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          >
            {linking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Link Email
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

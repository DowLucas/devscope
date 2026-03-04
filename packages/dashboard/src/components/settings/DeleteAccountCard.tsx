import { useState } from "react";
import { useLocation } from "wouter";
import { Trash2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { apiFetch } from "@/lib/api";

export function DeleteAccountCard() {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/account", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? "Failed to delete account");
        return;
      }
      await authClient.signOut();
      setLocation("/auth/sign-in");
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-destructive">Delete Account</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Your account will be marked for deletion and you will be signed out immediately.
          This cannot be undone.
        </p>
      </div>

      <button
        onClick={() => { setOpen(true); setConfirm(""); setError(null); }}
        className="inline-flex items-center gap-2 rounded-md border border-destructive/50 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
      >
        <Trash2 className="h-4 w-4" />
        Delete my account
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-xl space-y-4">
            <h2 className="text-base font-semibold">Are you absolutely sure?</h2>
            <p className="text-sm text-muted-foreground">
              This will mark your account for deletion and sign you out immediately.
              Type <span className="font-mono font-semibold text-foreground">DELETE</span> to confirm.
            </p>

            <input
              type="text"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Type DELETE to confirm"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setOpen(false)}
                disabled={loading}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={confirm !== "DELETE" || loading}
                className="inline-flex items-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
              >
                {loading ? "Deleting…" : "Delete account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

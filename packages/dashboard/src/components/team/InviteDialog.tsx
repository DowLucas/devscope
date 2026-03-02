import { useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { useTeamStore } from "@/stores/teamStore";
import type { OrgRole } from "@devscope/shared";

interface InviteDialogProps {
  open: boolean;
  onClose: () => void;
  onInvited?: () => void;
}

export function InviteDialog({ open, onClose, onInvited }: InviteDialogProps) {
  const currentTeam = useTeamStore((s) => s.currentTeam);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentTeam || !email.trim()) return;

    setSubmitting(true);
    try {
      const { error } = await authClient.organization.inviteMember({
        email: email.trim(),
        role,
        organizationId: currentTeam.id,
      });

      if (error) {
        toast.error(error.message ?? "Failed to send invitation");
        return;
      }

      toast.success(`Invitation sent to ${email.trim()}`);
      setEmail("");
      setRole("member");
      onInvited?.();
      onClose();
    } catch (err) {
      console.error("[InviteDialog]", err);
      toast.error("An unexpected error occurred");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-background rounded-lg border shadow-lg p-6 w-full max-w-md">
        <div className="flex items-center gap-2 mb-4">
          <UserPlus className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Invite Team Member</h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="invite-email"
              className="text-sm font-medium text-foreground"
            >
              Email address
            </label>
            <input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="invite-role"
              className="text-sm font-medium text-foreground"
            >
              Role
            </label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as OrgRole)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Admins can invite members, change roles, and manage team settings.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none transition-colors"
            >
              {submitting ? "Sending..." : "Send Invite"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

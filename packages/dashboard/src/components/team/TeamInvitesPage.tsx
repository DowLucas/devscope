import { Mail, UserPlus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useTeamStore } from "@/stores/teamStore";

interface TeamInvitesPageProps {
  onInvite?: () => void;
}

export function TeamInvitesPage({ onInvite }: TeamInvitesPageProps) {
  const isAdmin = useTeamStore((s) => s.isAdmin());

  return (
    <Card>
      <CardContent className="py-8">
        <div className="text-center space-y-3">
          <Mail className="h-10 w-10 text-muted-foreground/40 mx-auto" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              Team Invitations
            </p>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Invitations are sent via email. When a team member accepts an
              invitation, they will appear on the Members page.
            </p>
          </div>
          {isAdmin && onInvite && (
            <button
              onClick={onInvite}
              className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-accent transition-colors mt-2"
            >
              <UserPlus className="h-4 w-4" />
              Send an Invite
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

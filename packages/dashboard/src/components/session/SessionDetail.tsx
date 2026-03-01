import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, Clock, Wrench, MessageSquare, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SessionTurnCard } from "./SessionTurnCard";
import { buildTurns } from "@/lib/buildTurns";
import type { SessionDetail as SessionDetailType } from "@devscope/shared";
import type { SessionTurn } from "@devscope/shared";
import { parseUTC } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

interface SessionDetailProps {
  sessionId: string;
}

export function SessionDetail({ sessionId }: SessionDetailProps) {
  const [data, setData] = useState<SessionDetailType | null>(null);
  const [turns, setTurns] = useState<SessionTurn[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch(`/api/sessions/${sessionId}`)
      .then((r) => r.json())
      .then((d: SessionDetailType) => {
        setData(d);
        setTurns(buildTurns(d.events));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return (
      <div className="text-muted-foreground text-center py-12 text-sm">
        Loading session...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-muted-foreground text-center py-12 text-sm">
        Session not found.
      </div>
    );
  }

  const { session } = data;
  const startTime = parseUTC(session.startedAt);
  const endTime = session.endedAt ? parseUTC(session.endedAt) : null;
  const durationMs = endTime ? endTime.getTime() - startTime.getTime() : Date.now() - startTime.getTime();
  const durationMin = Math.round(durationMs / 60000);

  const totalTools = turns.reduce((sum, t) => sum + t.toolCalls.length, 0);
  const totalFails = turns.reduce((sum, t) => sum + t.toolCalls.filter((tc) => tc.success === false).length, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-lg font-semibold">{session.projectName}</h2>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <User className="h-3.5 w-3.5" />
                  {session.developerName}
                </div>
              </div>
              <Badge
                variant={session.status === "active" ? "default" : "secondary"}
                className={session.status === "active" ? "bg-emerald-600" : ""}
              >
                {session.status}
              </Badge>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{durationMin}m</span>
              </div>
              <div className="flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{turns.length} turns</span>
              </div>
              <div className="flex items-center gap-2">
                <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{totalTools} tools</span>
              </div>
              <div className="flex items-center gap-2 text-destructive">
                {totalFails > 0 && <span>{totalFails} failures</span>}
              </div>
            </div>

            <p className="text-xs text-muted-foreground mt-2">
              {startTime.toLocaleString()}
              {endTime && ` - ${endTime.toLocaleString()}`}
            </p>
          </CardContent>
        </Card>
      </motion.div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">
          Conversation ({turns.length} turns)
        </h3>
        {turns.map((turn, i) => (
          <SessionTurnCard key={i} turn={turn} index={i} />
        ))}
        {turns.length === 0 && (
          <div className="text-muted-foreground text-center py-8 text-sm">
            No conversation turns recorded.
          </div>
        )}
      </div>
    </div>
  );
}

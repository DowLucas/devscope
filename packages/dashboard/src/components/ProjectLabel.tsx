import { Lock } from "lucide-react";

interface ProjectLabelProps {
  name: string | null | undefined;
  className?: string;
  /** Text shown when the project is hidden. */
  fallback?: string;
}

/**
 * A project name, or a lock + "Private" when the session's owner has not
 * opted in to sharing (the API returns a null project).
 */
export function ProjectLabel({ name, className, fallback = "Private" }: ProjectLabelProps) {
  if (name) return <span className={className}>{name}</span>;
  return (
    <span
      className={`inline-flex items-center gap-1 text-muted-foreground ${className ?? ""}`}
      title="The owner isn't sharing this with the team"
    >
      <Lock className="h-3 w-3 shrink-0" />
      {fallback}
    </span>
  );
}

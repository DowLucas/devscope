import { Badge } from "@/components/ui/badge";

const STATUS_STYLES: Record<
  string,
  { variant: "default" | "secondary" | "destructive" | "outline"; className: string }
> = {
  draft: { variant: "outline", className: "border-amber-500/50 text-amber-600" },
  approved: { variant: "outline", className: "border-blue-500/50 text-blue-600" },
  active: { variant: "outline", className: "border-green-500/50 text-green-600" },
  archived: {
    variant: "outline",
    className: "border-muted-foreground/50 text-muted-foreground",
  },
};

export function SkillStatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.draft;
  return (
    <Badge variant={style.variant} className={style.className}>
      {status}
    </Badge>
  );
}

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ButtonGroupProps {
  children: ReactNode;
}

export function ButtonGroup({ children }: ButtonGroupProps) {
  return (
    <div className="flex gap-1 rounded-lg border border-border p-1">
      {children}
    </div>
  );
}

interface ButtonGroupItemProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  icon?: LucideIcon;
}

export function ButtonGroupItem({
  active,
  onClick,
  children,
  icon: Icon,
}: ButtonGroupItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </button>
  );
}

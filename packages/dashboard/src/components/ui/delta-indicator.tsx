import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface DeltaIndicatorProps {
  value: number;
  size?: "sm" | "md";
}

const SIZE_CLASSES = {
  sm: { text: "text-xs", icon: "h-3 w-3" },
  md: { text: "text-sm", icon: "h-4 w-4" },
} as const;

export function DeltaIndicator({ value, size = "sm" }: DeltaIndicatorProps) {
  const { text, icon } = SIZE_CLASSES[size];

  if (value > 0) {
    return (
      <span className={cn("flex items-center gap-0.5 text-emerald-400 font-medium", text)}>
        <TrendingUp className={icon} />+{value}%
      </span>
    );
  }

  if (value < 0) {
    return (
      <span className={cn("flex items-center gap-0.5 text-destructive font-medium", text)}>
        <TrendingDown className={icon} />{value}%
      </span>
    );
  }

  return (
    <span className={cn("flex items-center gap-0.5 text-muted-foreground font-medium", text)}>
      <Minus className={icon} />0%
    </span>
  );
}

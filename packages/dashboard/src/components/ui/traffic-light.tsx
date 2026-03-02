import { cn } from "@/lib/utils";

interface TrafficLightProps {
  status: "green" | "yellow" | "red";
  size?: "sm" | "md" | "lg";
}

const SIZE_MAP = {
  sm: "h-2.5 w-2.5",
  md: "h-3.5 w-3.5",
  lg: "h-5 w-5",
};

const COLOR_MAP = {
  green: "bg-emerald-400",
  yellow: "bg-amber-400",
  red: "bg-red-500",
};

export function TrafficLight({ status, size = "md" }: TrafficLightProps) {
  return (
    <span
      className={cn("inline-block rounded-full", SIZE_MAP[size], COLOR_MAP[status])}
      aria-label={`Status: ${status}`}
    />
  );
}

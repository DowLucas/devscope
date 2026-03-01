import { useDateRange } from "@/hooks/useDateRange";

const PRESETS = [
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

export function DateRangePicker() {
  const { days, setDays } = useDateRange();

  return (
    <div className="flex items-center gap-1">
      {PRESETS.map((preset) => (
        <button
          key={preset.days}
          onClick={() => setDays(preset.days)}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
            days === preset.days
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
          }`}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}

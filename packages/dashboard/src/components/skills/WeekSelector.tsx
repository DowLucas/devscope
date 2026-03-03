const WEEK_OPTIONS = [
  { label: "4w", value: 4 },
  { label: "8w", value: 8 },
  { label: "12w", value: 12 },
  { label: "26w", value: 26 },
] as const;

interface WeekSelectorProps {
  value: number;
  onChange: (weeks: number) => void;
}

export function WeekSelector({ value, onChange }: WeekSelectorProps) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border p-1">
      {WEEK_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
            value === opt.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

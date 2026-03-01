interface TooltipEntry {
  name?: string;
  value?: number;
  color?: string;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: string | number;
}

export function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium text-foreground">{String(label)}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="text-muted-foreground">
          <span
            className="mr-2 inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          {entry.name}:{" "}
          <span className="font-medium text-foreground">
            {entry.value?.toLocaleString()}
          </span>
        </p>
      ))}
    </div>
  );
}

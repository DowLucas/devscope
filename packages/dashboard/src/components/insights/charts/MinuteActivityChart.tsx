import { useEffect, useRef, useState } from "react";
import type { MinuteActivityPoint } from "@devscope/shared";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useActivityStore } from "@/stores/activityStore";
import { apiFetch } from "@/lib/api";
import { ChartCard } from "../ChartCard";
import { ChartTooltip } from "./ChartTooltip";
import { CHART_COLORS, AXIS_STYLE, GRID_STYLE } from "./chartConfig";
import { ButtonGroup, ButtonGroupItem } from "@/components/ui/button-group";

const RANGE_PRESETS = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "14d", hours: 336 },
  { label: "30d", hours: 720 },
  { label: "90d", hours: 2160 },
] as const;

const SERIES = [
  { key: "prompts", name: "Prompts", color: CHART_COLORS.primary },
  { key: "tool_calls", name: "Tool Calls", color: CHART_COLORS.secondary },
  { key: "sessions", name: "Sessions", color: CHART_COLORS.tertiary },
] as const;

function formatTick(value: string, hours: number): string {
  const d = new Date(value);
  if (hours <= 24) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  if (hours <= 336) {
    return `${month}-${day} ${String(d.getHours()).padStart(2, "0")}:00`;
  }
  return `${month}-${day}`;
}

function tickInterval(_hours: number, dataLength: number): number {
  const target = 15;
  return Math.max(1, Math.floor(dataLength / target));
}

export function MinuteActivityChart() {
  const [hours, setHours] = useState(24);
  const [data, setData] = useState<MinuteActivityPoint[] | null>(null);
  const [fetchedHours, setFetchedHours] = useState<number | null>(null);
  const loading = fetchedHours !== hours;
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const eventsLength = useActivityStore((s) => s.events.length);
  const prevEventsLength = useRef(eventsLength);

  // Fetch data on mount and when range changes
  useEffect(() => {
    const currentHours = hours;
    const params = hours !== 24 ? `?hours=${hours}` : "";
    apiFetch(`/api/insights/activity-per-minute${params}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d as MinuteActivityPoint[]);
        setFetchedHours(currentHours);
      })
      .catch(() => {
        setFetchedHours(currentHours);
      });
  }, [hours]);

  // Bump the last bucket when new WS events arrive (only for short ranges)
  useEffect(() => {
    if (hours > 24) return;
    if (eventsLength > prevEventsLength.current && data?.length) {
      const diff = eventsLength - prevEventsLength.current;
      setData((prev) => {
        if (!prev?.length) return prev;
        const updated = [...prev];
        const last = updated[updated.length - 1];
        updated[updated.length - 1] = {
          ...last,
          event_count: last.event_count + diff,
        };
        return updated;
      });
    }
    prevEventsLength.current = eventsLength;
  }, [eventsLength, data?.length, hours]);

  // Refetch from API every 60s (only for short ranges)
  useEffect(() => {
    if (hours > 24) return;
    const interval = setInterval(() => {
      const params = hours !== 24 ? `?hours=${hours}` : "";
      apiFetch(`/api/insights/activity-per-minute${params}`)
        .then((r) => r.json())
        .then((d) => setData(d as MinuteActivityPoint[]))
        .catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, [hours]);

  const toggleSeries = (dataKey: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(dataKey)) next.delete(dataKey);
      else next.add(dataKey);
      return next;
    });
  };

  const rangeSelector = (
    <ButtonGroup>
      {RANGE_PRESETS.map((preset) => (
        <ButtonGroupItem
          key={preset.hours}
          active={hours === preset.hours}
          onClick={() => setHours(preset.hours)}
        >
          {preset.label}
        </ButtonGroupItem>
      ))}
    </ButtonGroup>
  );

  return (
    <ChartCard title="Activity Over Time" loading={loading} action={rangeSelector}>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data ?? []}>
          <CartesianGrid {...GRID_STYLE} />
          <XAxis
            dataKey="minute"
            {...AXIS_STYLE}
            tickFormatter={(v: string) => formatTick(v, hours)}
            interval={tickInterval(hours, data?.length ?? 0)}
          />
          <YAxis {...AXIS_STYLE} allowDecimals={false} />
          <Tooltip content={ChartTooltip} />
          <Legend
            onClick={(e) => toggleSeries(e.dataKey as string)}
            wrapperStyle={{ cursor: "pointer", fontSize: 12 }}
          />
          {SERIES.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stackId="1"
              fill={s.color}
              stroke={s.color}
              fillOpacity={hidden.has(s.key) ? 0 : 0.5}
              strokeOpacity={hidden.has(s.key) ? 0 : 1}
              hide={hidden.has(s.key)}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

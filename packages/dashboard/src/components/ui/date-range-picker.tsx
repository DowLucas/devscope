import { useDateRange } from "@/hooks/useDateRange";
import { ButtonGroup, ButtonGroupItem } from "@/components/ui/button-group";

const PRESETS = [
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

export function DateRangePicker() {
  const { days, setDays } = useDateRange();

  return (
    <ButtonGroup>
      {PRESETS.map((preset) => (
        <ButtonGroupItem
          key={preset.days}
          active={days === preset.days}
          onClick={() => setDays(preset.days)}
        >
          {preset.label}
        </ButtonGroupItem>
      ))}
    </ButtonGroup>
  );
}

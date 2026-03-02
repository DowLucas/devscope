import type { LucideIcon } from "lucide-react";
import { ButtonGroup, ButtonGroupItem } from "@/components/ui/button-group";

interface Tab<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
}

interface TabBarProps<T extends string> {
  tabs: Tab<T>[];
  active: T;
  onChange: (id: T) => void;
}

export function TabBar<T extends string>({
  tabs,
  active,
  onChange,
}: TabBarProps<T>) {
  return (
    <ButtonGroup>
      {tabs.map((tab) => (
        <ButtonGroupItem
          key={tab.id}
          active={tab.id === active}
          onClick={() => onChange(tab.id)}
          icon={tab.icon}
        >
          {tab.label}
        </ButtonGroupItem>
      ))}
    </ButtonGroup>
  );
}

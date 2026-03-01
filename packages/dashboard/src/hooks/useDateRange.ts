import { create } from "zustand";

interface DateRangeState {
  days: number;
  setDays: (days: number) => void;
}

export const useDateRange = create<DateRangeState>((set) => ({
  days: 30,
  setDays: (days) => set({ days }),
}));

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Parse a timestamp string, treating bare strings (no Z/offset) as UTC. */
export function parseUTC(timestamp: string): Date {
  const ts = timestamp.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(timestamp)
    ? timestamp
    : timestamp + "Z";
  return new Date(ts);
}

/** Human-friendly relative time string. */
export function timeAgo(timestamp: string): string {
  const diff = Date.now() - parseUTC(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return seconds + "s ago";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "h ago";
  const days = Math.floor(hours / 24);
  return days + "d ago";
}

import type { StatusColor } from "stewrd-plugin-api";

export type Priority = "none" | "normal" | "medium" | "high";

export interface Item {
  id: string;
  tabId: string;
  title: string;
  description: string;
  priority: Priority;
  /** When the priority was set or last escalated. */
  priorityAt: number;
  createdAt: number;
  done: boolean;
  doneAt?: number;
}

export interface Tab {
  id: string;
  name: string;
}

export interface Data {
  tabs: Tab[];
  items: Item[];
}

export const DAY = 24 * 60 * 60 * 1000;
export const PRIORITIES: Priority[] = ["none", "normal", "medium", "high"];

// Priority -> [next priority, time at this priority before moving up]
const ESCALATION: Partial<Record<Priority, [Priority, number]>> = {
  none: ["normal", 30 * DAY],
  normal: ["medium", 7 * DAY],
  medium: ["high", DAY],
};

export type SortOrder = "createdAsc" | "createdDesc" | "titleAsc" | "titleDesc";

export interface Settings {
  /** Days a completed item is kept before it is deleted. */
  completedRetentionDays: number;
  /** Priorities that drive the sidebar icon and tab dot colors. */
  reportedPriorities: Priority[];
  /** Order of items sharing a priority. */
  sortAfterPriority: SortOrder;
}

export const DEFAULT_SETTINGS: Settings = {
  completedRetentionDays: 30,
  reportedPriorities: ["normal", "medium", "high"],
  sortAfterPriority: "createdAsc",
};

const STATUS: Record<Priority, StatusColor> = {
  none: "idle",
  normal: "in-progress",
  medium: "warning",
  high: "error",
};

export const priorityLabel: Record<Priority, string> = {
  none: "No Priority",
  normal: "Normal",
  medium: "Medium",
  high: "High",
};

export function statusFor(priority: Priority): StatusColor {
  return STATUS[priority];
}

/** Moves each active item up as many levels as its elapsed time allows. */
export function escalate(items: Item[], now: number): Item[] {
  return items.map((item) => {
    if (item.done) return item;
    let { priority, priorityAt } = item;
    for (let step = ESCALATION[priority]; step && now - priorityAt >= step[1]; step = ESCALATION[priority]) {
      priorityAt += step[1];
      priority = step[0];
    }
    return priority === item.priority ? item : { ...item, priority, priorityAt };
  });
}

export function purgeDone(items: Item[], now: number, retentionDays: number): Item[] {
  return items.filter((item) => !item.done || now - (item.doneAt ?? now) < retentionDays * DAY);
}

export function setPriority(item: Item, priority: Priority, now: number): Item {
  return { ...item, priority, priorityAt: now };
}

export function setDone(item: Item, done: boolean, now: number): Item {
  return done
    ? { ...item, done: true, doneAt: now }
    : { ...item, done: false, doneAt: undefined, priorityAt: now };
}

/** Highest open priority among the reported priorities. */
export function topPriority(items: Item[], reported: Priority[]): Priority {
  return items.reduce<Priority>(
    (top, item) =>
      !item.done && reported.includes(item.priority) && PRIORITIES.indexOf(item.priority) > PRIORITIES.indexOf(top)
        ? item.priority
        : top,
    "none",
  );
}

const TIEBREAK: Record<SortOrder, (a: Item, b: Item) => number> = {
  createdAsc: (a, b) => a.createdAt - b.createdAt,
  createdDesc: (a, b) => b.createdAt - a.createdAt,
  titleAsc: (a, b) => a.title.localeCompare(b.title),
  titleDesc: (a, b) => b.title.localeCompare(a.title),
};

/** Active items, highest priority first, then the configured order. */
export function sortActive(items: Item[], order: SortOrder): Item[] {
  return items
    .filter((item) => !item.done)
    .sort((a, b) => PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority) || TIEBREAK[order](a, b));
}

/** Newest completion first. */
export function sortDone(items: Item[]): Item[] {
  return items.filter((item) => item.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
}

export function moveTab(tabs: Tab[], fromId: string, toId: string): Tab[] {
  const from = tabs.findIndex((t) => t.id === fromId);
  const to = tabs.findIndex((t) => t.id === toId);
  if (from < 0 || to < 0 || from === to) return tabs;
  const next = tabs.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

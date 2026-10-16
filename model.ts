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

export type Repeat = "once" | "daily" | "weekly" | "monthly";

/** Template that creates an Item on its tab each time nextAt passes. */
export interface Schedule {
  id: string;
  tabId: string;
  title: string;
  description: string;
  priority: Priority;
  repeat: Repeat;
  nextAt: number;
  /** Day of month of the first occurrence, so a clamped month (Feb 28) returns to it (Mar 31). */
  anchorDay: number;
}

export interface Data {
  tabs: Tab[];
  items: Item[];
  schedules?: Schedule[];
  /** Display order of every tab id, including COMBINED_ID. */
  tabOrder?: string[];
  activeTabId?: string;
}

/** Virtual tab showing the items of all tabs; not stored in Data.tabs. */
export const COMBINED_ID = "combined";

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
  /** Show a Combined tab (all items) when there is more than one tab. */
  showCombinedTab: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  completedRetentionDays: 30,
  reportedPriorities: ["normal", "medium", "high"],
  sortAfterPriority: "createdAsc",
  showCombinedTab: true,
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

/** Saved order with unknown ids dropped, missing tabs appended and Combined defaulting to the left. */
export function reconcileOrder(data: Data): string[] {
  const known = new Set([COMBINED_ID, ...data.tabs.map((t) => t.id)]);
  const order = (data.tabOrder ?? []).filter((id, i, all) => known.has(id) && all.indexOf(id) === i);
  if (!order.includes(COMBINED_ID)) order.unshift(COMBINED_ID);
  for (const tab of data.tabs) if (!order.includes(tab.id)) order.push(tab.id);
  return order;
}

/** Tabs as displayed; Combined only appears when enabled and there is more than one tab. */
export function orderedTabs(data: Data, showCombined: boolean): Tab[] {
  const byId = new Map<string, Tab>([[COMBINED_ID, { id: COMBINED_ID, name: "Combined" }], ...data.tabs.map((t): [string, Tab] => [t.id, t])]);
  const withCombined = showCombined && data.tabs.length > 1;
  return reconcileOrder(data)
    .filter((id) => withCombined || id !== COMBINED_ID)
    .map((id) => byId.get(id)!);
}

/** Moves a tab in front of another tab, or to the end when beforeId is null. */
export function moveTabBefore(order: string[], id: string, beforeId: string | null): string[] {
  if (id === beforeId || !order.includes(id)) return order;
  const next = order.filter((o) => o !== id);
  next.splice(beforeId === null ? next.length : next.indexOf(beforeId), 0, id);
  return next;
}

/** The saved active tab if it is displayed, otherwise the first displayed tab. */
export function resolveActiveTab(activeId: string | undefined, tabs: Tab[]): string {
  return tabs.some((t) => t.id === activeId) ? activeId! : tabs[0].id;
}

export const repeatLabel: Record<Repeat, string> = {
  once: "Once",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

/** Local timestamp from a DatePicker "YYYY-MM-DD" and TimePicker "HH:MM" (Date's string parser would read the date as UTC). */
export function toTimestamp(date: string, time: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}

/** The occurrence after `at`, using calendar math so the local time of day survives DST changes. */
export function nextOccurrence(at: number, repeat: Repeat, anchorDay: number): number {
  const next = new Date(at);
  if (repeat === "daily") next.setDate(next.getDate() + 1);
  else if (repeat === "weekly") next.setDate(next.getDate() + 7);
  else if (repeat === "monthly") {
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    next.setDate(Math.min(anchorDay, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
  }
  return next.getTime();
}

/** Turns every due schedule into an Item and advances or removes it. Returns the same Data when nothing is due. */
export function fireDue(data: Data, now: number): Data {
  const schedules = data.schedules ?? [];
  if (!schedules.some((s) => s.nextAt <= now)) return data;
  const items = [...data.items];
  const remaining: Schedule[] = [];
  for (const s of schedules) {
    if (s.nextAt > now) {
      remaining.push(s);
      continue;
    }
    items.push({ id: crypto.randomUUID(), tabId: s.tabId, title: s.title, description: s.description, priority: s.priority, priorityAt: now, createdAt: now, done: false });
    if (s.repeat === "once") continue;
    let nextAt = s.nextAt;
    while (nextAt <= now) nextAt = nextOccurrence(nextAt, s.repeat, s.anchorDay);
    remaining.push({ ...s, nextAt });
  }
  return { ...data, items, schedules: remaining };
}

export function itemsForTab(items: Item[], tabId: string): Item[] {
  return tabId === COMBINED_ID ? items : items.filter((i) => i.tabId === tabId);
}

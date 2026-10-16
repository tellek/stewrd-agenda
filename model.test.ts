import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY, escalate, fireDue, itemsForTab, nextOccurrence, toTimestamp, moveTabBefore, orderedTabs, purgeDone, reconcileOrder, resolveActiveTab, setDone, setPriority, sortActive, statusFor, topPriority } from "./model.ts";
import type { Data, Item, Priority, Schedule } from "./model.ts";

const item = (over: Partial<Item> = {}): Item => ({
  id: "a", tabId: "t", title: "x", description: "", priority: "none",
  priorityAt: 0, createdAt: 0, done: false, ...over,
});

test("none becomes normal after a month, not before", () => {
  assert.equal(escalate([item()], 30 * DAY - 1)[0].priority, "none");
  assert.equal(escalate([item()], 30 * DAY)[0].priority, "normal");
});

test("normal becomes medium after a week", () => {
  assert.equal(escalate([item({ priority: "normal" })], 7 * DAY)[0].priority, "medium");
});

test("medium becomes high after a day, and high stays", () => {
  assert.equal(escalate([item({ priority: "medium" })], DAY)[0].priority, "high");
  assert.equal(escalate([item({ priority: "high" })], 999 * DAY)[0].priority, "high");
});

test("long gap cascades through every level", () => {
  assert.equal(escalate([item()], 38 * DAY)[0].priority, "high");
  const mid = escalate([item()], 31 * DAY)[0];
  assert.equal(mid.priority, "normal");
  assert.equal(mid.priorityAt, 30 * DAY);
});

test("done items do not escalate", () => {
  assert.equal(escalate([item({ done: true, doneAt: 0 })], 99 * DAY)[0].priority, "none");
});

test("restoring resets the escalation clock", () => {
  const done = setDone(item({ priority: "normal" }), true, 0);
  const restored = setDone(done, false, 10 * DAY);
  assert.equal(escalate([restored], 10 * DAY)[0].priority, "normal");
});

test("setPriority resets the clock", () => {
  const p = setPriority(item(), "medium", 5 * DAY);
  assert.equal(escalate([p], 5 * DAY + DAY - 1)[0].priority, "medium");
});

test("done items are purged after 30 days", () => {
  const items = [item({ done: true, doneAt: 0 }), item({ id: "b" })];
  assert.equal(purgeDone(items, 30 * DAY - 1, 30).length, 2);
  assert.deepEqual(purgeDone(items, 30 * DAY, 30).map((i) => i.id), ["b"]);
});

test("topPriority ignores done items and maps to status", () => {
  const items = [item({ priority: "high", done: true }), item({ priority: "medium" }), item({ priority: "normal" })];
  const all: Priority[] = ["normal", "medium", "high"];
  assert.equal(topPriority(items, all), "medium");
  assert.equal(topPriority([], all), "none");
  const order: Priority[] = ["high", "medium", "normal", "none"];
  assert.deepEqual(order.map(statusFor), ["error", "warning", "in-progress", "idle"]);
});

test("purge honors a custom retention", () => {
  const items = [item({ done: true, doneAt: 0 })];
  assert.equal(purgeDone(items, 7 * DAY, 7).length, 0);
  assert.equal(purgeDone(items, 7 * DAY - 1, 7).length, 1);
});

test("topPriority only reports configured priorities", () => {
  const items = [item({ priority: "high" }), item({ priority: "medium" })];
  assert.equal(topPriority(items, ["medium"]), "medium");
  assert.equal(topPriority(items, []), "none");
});

test("sortActive orders by priority then the configured order", () => {
  const items = [
    item({ id: "1", title: "b", priority: "normal", createdAt: 1 }),
    item({ id: "2", title: "a", priority: "normal", createdAt: 2 }),
    item({ id: "3", title: "z", priority: "high", createdAt: 3 }),
  ];
  const ids = (order: Parameters<typeof sortActive>[1]) => sortActive(items, order).map((i) => i.id);
  assert.deepEqual(ids("createdAsc"), ["3", "1", "2"]);
  assert.deepEqual(ids("createdDesc"), ["3", "2", "1"]);
  assert.deepEqual(ids("titleAsc"), ["3", "2", "1"]);
  assert.deepEqual(ids("titleDesc"), ["3", "1", "2"]);
});

const tab = (id: string) => ({ id, name: id });

test("moveTabBefore moves left, right, to the end and ignores self", () => {
  const order = ["combined", "a", "b", "c"];
  assert.deepEqual(moveTabBefore(order, "c", "a"), ["combined", "c", "a", "b"]);
  assert.deepEqual(moveTabBefore(order, "a", "c"), ["combined", "b", "a", "c"]);
  assert.deepEqual(moveTabBefore(order, "a", null), ["combined", "b", "c", "a"]);
  assert.equal(moveTabBefore(order, "a", "a"), order);
});

test("reconcileOrder drops unknown ids, appends missing tabs and puts Combined first", () => {
  const data = { tabs: [tab("a"), tab("b"), tab("c")], items: [], tabOrder: ["b", "gone", "a"] };
  assert.deepEqual(reconcileOrder(data), ["combined", "b", "a", "c"]);
  assert.deepEqual(reconcileOrder({ ...data, tabOrder: ["a", "combined", "b", "c"] }), ["a", "combined", "b", "c"]);
});

test("orderedTabs shows Combined only when enabled and more than one tab", () => {
  const two = { tabs: [tab("a"), tab("b")], items: [] };
  const ids = (d: typeof two, show: boolean) => orderedTabs(d, show).map((t) => t.id);
  assert.deepEqual(ids(two, true), ["combined", "a", "b"]);
  assert.deepEqual(ids(two, false), ["a", "b"]);
  assert.deepEqual(ids({ tabs: [tab("a")], items: [] }, true), ["a"]);
  assert.deepEqual(ids({ ...two, tabs: [...two.tabs, tab("new")], tabOrder: ["combined", "b", "a"] }, true), ["combined", "b", "a", "new"]);
});

test("resolveActiveTab falls back to the first displayed tab", () => {
  const tabs = [tab("a"), tab("b")];
  assert.equal(resolveActiveTab("b", tabs), "b");
  assert.equal(resolveActiveTab("combined", tabs), "a");
  assert.equal(resolveActiveTab(undefined, tabs), "a");
});

test("itemsForTab returns every item for Combined", () => {
  const items = [item({ id: "1", tabId: "a" }), item({ id: "2", tabId: "b" })];
  assert.equal(itemsForTab(items, "combined").length, 2);
  assert.deepEqual(itemsForTab(items, "b").map((i) => i.id), ["2"]);
});

const sched = (over: Partial<Schedule> = {}): Schedule => ({
  id: "s", tabId: "t", title: "Pay rent", description: "", priority: "none",
  repeat: "once", nextAt: 1000, anchorDay: 1, ...over,
});
const data = (schedules: Schedule[]): Data => ({ tabs: [{ id: "t", name: "T" }], items: [], schedules });

test("toTimestamp reads date and time as local", () => {
  const d = new Date(toTimestamp("2026-03-05", "14:30"));
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 2, 5, 14, 30]);
});

test("monthly keeps the anchor day after a short month", () => {
  const jan31 = toTimestamp("2026-01-31", "09:00");
  const feb = nextOccurrence(jan31, "monthly", 31);
  assert.equal(new Date(feb).getDate(), 28);
  assert.equal(new Date(nextOccurrence(feb, "monthly", 31)).getDate(), 31);
});

test("daily and weekly keep the local time of day", () => {
  const at = toTimestamp("2026-03-07", "09:00");
  assert.equal(new Date(nextOccurrence(at, "daily", 7)).getHours(), 9);
  assert.equal(new Date(nextOccurrence(at, "weekly", 7)).getDate(), 14);
});

test("fireDue leaves data alone when nothing is due", () => {
  const d = data([sched({ nextAt: 5000 })]);
  assert.equal(fireDue(d, 1000), d);
});

test("a due once schedule becomes an item and is removed", () => {
  const out = fireDue(data([sched()]), 2000);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].title, "Pay rent");
  assert.equal(out.items[0].priorityAt, 2000);
  assert.deepEqual(out.schedules, []);
});

test("an overdue recurring schedule fires once and moves past now", () => {
  const now = 10 * DAY;
  const out = fireDue(data([sched({ repeat: "daily", nextAt: DAY })]), now);
  assert.equal(out.items.length, 1);
  assert.ok(out.schedules![0].nextAt > now);
});

test("a schedule does not add an item while its previous one is still open", () => {
  const d = data([sched({ repeat: "daily", nextAt: 1000 })]);
  const first = fireDue(d, 2000);
  const second = fireDue({ ...first, schedules: [{ ...first.schedules![0], nextAt: 3000 }] }, 4000);
  assert.equal(second.items.length, 1);
  assert.equal(second.schedules![0].nextAt > 4000, true);
  const done = { ...second, items: second.items.map((i) => ({ ...i, done: true })), schedules: [{ ...second.schedules![0], nextAt: 5000 }] };
  assert.equal(fireDue(done, 6000).items.length, 2);
});

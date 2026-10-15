import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY, escalate, moveTab, purgeDone, setDone, setPriority, sortActive, statusFor, topPriority } from "./model.ts";
import type { Item, Priority } from "./model.ts";

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

test("moveTab reorders", () => {
  const tabs = [{ id: "1", name: "a" }, { id: "2", name: "b" }, { id: "3", name: "c" }];
  assert.deepEqual(moveTab(tabs, "1", "3").map((t) => t.id), ["2", "3", "1"]);
  assert.equal(moveTab(tabs, "1", "1"), tabs);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY, escalate, moveTab, purgeDone, setDone, setPriority, statusFor, topPriority } from "./model.ts";
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
  assert.equal(purgeDone(items, 30 * DAY - 1).length, 2);
  assert.deepEqual(purgeDone(items, 30 * DAY).map((i) => i.id), ["b"]);
});

test("topPriority ignores done items and maps to status", () => {
  const items = [item({ priority: "high", done: true }), item({ priority: "medium" }), item({ priority: "normal" })];
  assert.equal(topPriority(items), "medium");
  assert.equal(topPriority([]), "none");
  const order: Priority[] = ["high", "medium", "normal", "none"];
  assert.deepEqual(order.map(statusFor), ["error", "warning", "in-progress", "idle"]);
});

test("moveTab reorders", () => {
  const tabs = [{ id: "1", name: "a" }, { id: "2", name: "b" }, { id: "3", name: "c" }];
  assert.deepEqual(moveTab(tabs, "1", "3").map((t) => t.id), ["2", "3", "1"]);
  assert.equal(moveTab(tabs, "1", "1"), tabs);
});

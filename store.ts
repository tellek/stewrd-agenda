// One shared store for the tick handler and the pane, so neither overwrites
// the other's edits. Saves are debounced and flushed on dispose.
import type { PluginApi } from "stewrd-plugin-api";
import { escalate, purgeDone, statusFor, topPriority } from "./model.ts";
import type { Data } from "./model.ts";
import { setStatus } from "./status.ts";

export interface State {
  data: Data;
  activeTabId: string;
}

const KEY = "data";
const SAVE_DEBOUNCE_MS = 500;

let api: PluginApi | undefined;
let state: State = { data: { tabs: [], items: [] }, activeTabId: "" };
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

export const newId = () => crypto.randomUUID();

export function getState(): State {
  return state;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function set(next: State) {
  state = next;
  listeners.forEach((fn) => fn());
}

export async function init(pluginApi: PluginApi) {
  api = pluginApi;
  const stored = await api.storage.get<Data>(KEY);
  const data: Data = stored?.tabs?.length ? stored : { tabs: [{ id: newId(), name: "General" }], items: stored?.items ?? [] };
  set({ data, activeTabId: data.tabs[0].id });
  refresh();
}

/** Escalates priorities, drops expired done items, and republishes the sidebar status. */
export function refresh() {
  const now = Date.now();
  const items = purgeDone(escalate(state.data.items, now), now);
  const changed = items.length !== state.data.items.length || items.some((item, i) => item !== state.data.items[i]);
  if (changed) update((data) => ({ ...data, items }));
  publish();
}

export function publish() {
  if (!api) return;
  const top = topPriority(state.data.items);
  setStatus(api, "priority", statusFor(top), top === "none" ? undefined : `Highest priority: ${top}`);
}

export function update(fn: (data: Data) => Data) {
  set({ ...state, data: fn(state.data) });
  publish();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, SAVE_DEBOUNCE_MS);
}

export function setActiveTab(id: string) {
  set({ ...state, activeTabId: id });
}

export function flush() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!api) return;
  const pluginApi = api;
  pluginApi.storage.set(KEY, state.data).then(
    () => setStatus(pluginApi, "save", "idle"),
    (err) => setStatus(pluginApi, "save", "error", `Save failed: ${err}`),
  );
}

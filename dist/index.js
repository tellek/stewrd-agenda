// index.tsx
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";

// model.ts
var COMBINED_ID = "combined";
var DAY = 24 * 60 * 60 * 1e3;
var PRIORITIES = ["none", "normal", "medium", "high"];
var ESCALATION = {
  none: ["normal", 30 * DAY],
  normal: ["medium", 7 * DAY],
  medium: ["high", DAY]
};
var DEFAULT_SETTINGS = {
  completedRetentionDays: 30,
  reportedPriorities: ["normal", "medium", "high"],
  sortAfterPriority: "createdAsc",
  showCombinedTab: true
};
var STATUS = {
  none: "idle",
  normal: "in-progress",
  medium: "warning",
  high: "error"
};
var priorityLabel = {
  none: "No Priority",
  normal: "Normal",
  medium: "Medium",
  high: "High"
};
function statusFor(priority) {
  return STATUS[priority];
}
function escalate(items, now) {
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
function purgeDone(items, now, retentionDays) {
  return items.filter((item) => !item.done || now - (item.doneAt ?? now) < retentionDays * DAY);
}
function setPriority(item, priority, now) {
  return { ...item, priority, priorityAt: now };
}
function setDone(item, done, now) {
  return done ? { ...item, done: true, doneAt: now } : { ...item, done: false, doneAt: void 0, priorityAt: now };
}
function topPriority(items, reported) {
  return items.reduce(
    (top, item) => !item.done && reported.includes(item.priority) && PRIORITIES.indexOf(item.priority) > PRIORITIES.indexOf(top) ? item.priority : top,
    "none"
  );
}
var TIEBREAK = {
  createdAsc: (a, b) => a.createdAt - b.createdAt,
  createdDesc: (a, b) => b.createdAt - a.createdAt,
  titleAsc: (a, b) => a.title.localeCompare(b.title),
  titleDesc: (a, b) => b.title.localeCompare(a.title)
};
function sortActive(items, order) {
  return items.filter((item) => !item.done).sort((a, b) => PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority) || TIEBREAK[order](a, b));
}
function sortDone(items) {
  return items.filter((item) => item.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
}
function reconcileOrder(data) {
  const known = /* @__PURE__ */ new Set([COMBINED_ID, ...data.tabs.map((t) => t.id)]);
  const order = (data.tabOrder ?? []).filter((id, i, all) => known.has(id) && all.indexOf(id) === i);
  if (!order.includes(COMBINED_ID)) order.unshift(COMBINED_ID);
  for (const tab of data.tabs) if (!order.includes(tab.id)) order.push(tab.id);
  return order;
}
function orderedTabs(data, showCombined) {
  const byId = new Map([[COMBINED_ID, { id: COMBINED_ID, name: "Combined" }], ...data.tabs.map((t) => [t.id, t])]);
  const withCombined = showCombined && data.tabs.length > 1;
  return reconcileOrder(data).filter((id) => withCombined || id !== COMBINED_ID).map((id) => byId.get(id));
}
function moveTabBefore(order, id, beforeId) {
  if (id === beforeId || !order.includes(id)) return order;
  const next = order.filter((o) => o !== id);
  next.splice(beforeId === null ? next.length : next.indexOf(beforeId), 0, id);
  return next;
}
function resolveActiveTab(activeId, tabs) {
  return tabs.some((t) => t.id === activeId) ? activeId : tabs[0].id;
}
var repeatLabel = {
  once: "Once",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly"
};
function toTimestamp(date, time) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}
function nextOccurrence(at, repeat, anchorDay) {
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
function fireDue(data, now) {
  const schedules = data.schedules ?? [];
  if (!schedules.some((s) => s.nextAt <= now)) return data;
  const items = [...data.items];
  const remaining = [];
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
function itemsForTab(items, tabId) {
  return tabId === COMBINED_ID ? items : items.filter((i) => i.tabId === tabId);
}

// settings.ts
import { invoke } from "@tauri-apps/api/core";
var SORT_ORDERS = ["createdAsc", "createdDesc", "titleAsc", "titleDesc"];
async function loadSettings(pluginId) {
  try {
    const parsed = JSON.parse(await invoke("read_plugin_settings_file", { dir: pluginId }));
    const days = parsed.completedRetentionDays;
    return {
      completedRetentionDays: typeof days === "number" && days >= 0 ? days : DEFAULT_SETTINGS.completedRetentionDays,
      reportedPriorities: Array.isArray(parsed.reportedPriorities) ? parsed.reportedPriorities.filter((p) => PRIORITIES.includes(p)) : DEFAULT_SETTINGS.reportedPriorities,
      sortAfterPriority: SORT_ORDERS.includes(parsed.sortAfterPriority) ? parsed.sortAfterPriority : DEFAULT_SETTINGS.sortAfterPriority,
      showCombinedTab: typeof parsed.showCombinedTab === "boolean" ? parsed.showCombinedTab : DEFAULT_SETTINGS.showCombinedTab
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// status.ts
var PRIORITY = ["idle", "success", "in-progress", "warning", "error"];
var SUCCESS_RESET_MS = 3e3;
var colors = { priority: "idle", save: "idle" };
var listeners = /* @__PURE__ */ new Set();
var lastApi;
var viewing = false;
var resetTimer;
function setStatus(api2, source, color, tooltip) {
  lastApi = api2;
  colors[source] = color;
  publish(tooltip);
  scheduleReset();
}
function setViewing(value) {
  viewing = value;
  scheduleReset();
}
function publish(tooltip) {
  const worst = Object.values(colors).reduce((a, b) => PRIORITY.indexOf(b) > PRIORITY.indexOf(a) ? b : a, "idle");
  try {
    lastApi?.statusIcon.set(worst, tooltip);
  } catch {
  }
  listeners.forEach((fn) => fn());
}
function scheduleReset() {
  if (resetTimer) clearTimeout(resetTimer);
  resetTimer = void 0;
  const pending = Object.values(colors).includes("success");
  if (!pending || !viewing || !document.hasFocus()) return;
  resetTimer = setTimeout(() => {
    resetTimer = void 0;
    for (const source of Object.keys(colors)) {
      if (colors[source] === "success") colors[source] = "idle";
    }
    publish();
  }, SUCCESS_RESET_MS);
}
window.addEventListener("focus", scheduleReset);
window.addEventListener("blur", scheduleReset);

// store.ts
var KEY = "data";
var SAVE_DEBOUNCE_MS = 500;
var api;
var state = { data: { tabs: [], items: [] }, activeTabId: "", settings: DEFAULT_SETTINGS };
var saveTimer;
var listeners2 = /* @__PURE__ */ new Set();
var newId = () => crypto.randomUUID();
function getState() {
  return state;
}
function subscribe(fn) {
  listeners2.add(fn);
  return () => listeners2.delete(fn);
}
function set(next) {
  state = next;
  listeners2.forEach((fn) => fn());
}
async function init(pluginApi) {
  api = pluginApi;
  const settings = await loadSettings("agenda");
  const stored = await api.storage.get(KEY);
  const base = stored?.tabs?.length ? stored : { tabs: [{ id: newId(), name: "General" }], items: stored?.items ?? [] };
  const data = { ...base, tabOrder: reconcileOrder(base) };
  set({ data, activeTabId: resolveActiveTab(data.activeTabId, orderedTabs(data, settings.showCombinedTab)), settings });
  refresh();
}
async function reloadSettings() {
  const settings = await loadSettings("agenda");
  set({ ...state, settings, activeTabId: resolveActiveTab(state.activeTabId, orderedTabs(state.data, settings.showCombinedTab)) });
  refresh();
}
function refresh() {
  const now = Date.now();
  const fired = fireDue(state.data, now);
  const items = purgeDone(escalate(fired.items, now), now, state.settings.completedRetentionDays);
  const changed = fired !== state.data || items.length !== fired.items.length || items.some((item, i) => item !== fired.items[i]);
  if (changed) update(() => ({ ...fired, items }));
  publish2();
}
function publish2() {
  if (!api) return;
  const top = topPriority(state.data.items, state.settings.reportedPriorities);
  setStatus(api, "priority", statusFor(top), top === "none" ? void 0 : `Highest priority: ${top}`);
}
function update(fn) {
  set({ ...state, data: fn(state.data) });
  publish2();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, SAVE_DEBOUNCE_MS);
}
function setActiveTab(id) {
  set({ ...state, activeTabId: id });
  update((d) => ({ ...d, activeTabId: id }));
}
function flush() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = void 0;
  if (!api) return;
  const pluginApi = api;
  pluginApi.storage.set(KEY, state.data).then(
    () => setStatus(pluginApi, "save", "idle"),
    (err) => setStatus(pluginApi, "save", "error", `Save failed: ${err}`)
  );
}

// index.tsx
import { jsx, jsxs } from "react/jsx-runtime";
var TICK_MS = 60 * 1e3;
var TAB_DRAG_TYPE = "application/x-agenda-tab";
async function activate(ctx) {
  await init(ctx.api);
  ctx.tick.register(() => refresh());
  ctx.tick.setInterval(TICK_MS);
  ctx.tick.requestWake(2e3);
  ctx.onDispose(flush);
}
var priorityOptions = PRIORITIES.slice().reverse().map((p) => ({ label: priorityLabel[p], value: p }));
var repeatOptions = Object.keys(repeatLabel).map((r) => ({ label: repeatLabel[r], value: r }));
function Component({ api: api2 }) {
  const { data, activeTabId, settings } = useSyncExternalStore(subscribe, getState);
  const palette = api2.theme.palette;
  const { TextButton, StatusDot } = api2.ui;
  const [dialog, setDialog] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [dropBefore, setDropBefore] = useState(void 0);
  const rootRef = useRef(null);
  const [, setThemeVersion] = useState(0);
  useEffect(() => {
    setViewing(true);
    reloadSettings();
    const unsubscribe = api2.theme.subscribe(() => setThemeVersion((v) => v + 1));
    return () => {
      setViewing(false);
      unsubscribe();
    };
  }, [api2]);
  const tabs = orderedTabs(data, settings.showCombinedTab);
  const tabItems = itemsForTab(data.items, activeTabId);
  const active = sortActive(tabItems, settings.sortAfterPriority);
  const done = sortDone(tabItems);
  const tabStyle = (selected) => ({
    padding: "6px 12px",
    cursor: "pointer",
    userSelect: "none",
    color: selected ? palette.accent : palette.textMuted,
    borderBottom: `2px solid ${selected ? palette.accent : "transparent"}`
  });
  const stopDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const endDrag = () => {
    setDragId(null);
    setDropBefore(void 0);
  };
  const dropTab = (e) => {
    stopDrag(e);
    if (dragId && dropBefore !== void 0) update((d) => ({ ...d, tabOrder: moveTabBefore(reconcileOrder(d), dragId, dropBefore) }));
    endDrag();
  };
  const pipe = /* @__PURE__ */ jsx("div", { style: { width: 2, alignSelf: "stretch", background: palette.accent, flexShrink: 0 } });
  return /* @__PURE__ */ jsxs("div", { ref: rootRef, "data-agenda-root": true, style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 8, position: "relative" }, children: [
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${palette.border}` }, children: [
      /* @__PURE__ */ jsxs(
        "div",
        {
          style: { display: "flex", alignItems: "center", flex: 1, minWidth: 0, overflowX: "auto" },
          onDragEnter: stopDrag,
          onDragOver: (e) => {
            stopDrag(e);
            if (dragId) setDropBefore(null);
          },
          onDrop: dropTab,
          children: [
            tabs.map((tab, index) => /* @__PURE__ */ jsxs(Fragment, { children: [
              dragId && dropBefore === tab.id && pipe,
              /* @__PURE__ */ jsx(
                "div",
                {
                  draggable: true,
                  style: tabStyle(tab.id === activeTabId),
                  onClick: () => setActiveTab(tab.id),
                  onContextMenu: (e) => {
                    e.preventDefault();
                    if (tab.id !== COMBINED_ID) setDialog({ kind: "rename-tab", id: tab.id });
                  },
                  onDragStart: (e) => {
                    e.dataTransfer.setData(TAB_DRAG_TYPE, tab.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragId(tab.id);
                  },
                  onDragEnter: stopDrag,
                  onDragOver: (e) => {
                    stopDrag(e);
                    if (!dragId) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    setDropBefore(e.clientX < rect.left + rect.width / 2 ? tab.id : tabs[index + 1]?.id ?? null);
                  },
                  onDrop: dropTab,
                  onDragEnd: endDrag,
                  children: /* @__PURE__ */ jsxs("span", { style: { display: "inline-flex", alignItems: "center", gap: 6 }, children: [
                    /* @__PURE__ */ jsx(StatusDot, { color: statusFor(topPriority(itemsForTab(data.items, tab.id), settings.reportedPriorities)) }),
                    tab.name
                  ] })
                }
              )
            ] }, tab.id)),
            dragId && dropBefore === null && pipe,
            /* @__PURE__ */ jsx(TextButton, { label: "+", bordered: false, onClick: () => setDialog({ kind: "add-tab" }) })
          ]
        }
      ),
      /* @__PURE__ */ jsx(TextButton, { label: "Add Item", variant: "primary", onClick: () => setDialog({ kind: "add-item" }) }),
      /* @__PURE__ */ jsx(TextButton, { label: "Schedule", variant: "secondary", onClick: () => setDialog({ kind: "schedule" }) })
    ] }),
    /* @__PURE__ */ jsxs("div", { "data-agenda-list": true, style: { flex: 1, minHeight: 0, overflow: "auto", scrollbarWidth: "thin", scrollbarColor: `${palette.border} ${palette.surface}` }, children: [
      active.map((item) => /* @__PURE__ */ jsx(Row, { api: api2, item }, item.id)),
      active.length === 0 && /* @__PURE__ */ jsx("div", { style: { color: palette.textMuted, padding: 8 }, children: "Nothing To Do" }),
      done.length > 0 && /* @__PURE__ */ jsxs("div", { style: { marginTop: 24 }, children: [
        /* @__PURE__ */ jsx("div", { style: { color: palette.textMuted, padding: "4px 8px" }, children: "Completed" }),
        done.map((item) => /* @__PURE__ */ jsx(Row, { api: api2, item }, item.id))
      ] })
    ] }),
    dialog?.kind === "add-tab" && /* @__PURE__ */ jsx(
      NameDialog,
      {
        api: api2,
        title: "Add Tab",
        initial: "",
        onClose: () => setDialog(null),
        onSave: (name) => {
          const id = newId();
          update((d) => ({ ...d, tabs: [...d.tabs, { id, name }], tabOrder: [...reconcileOrder(d), id] }));
          setActiveTab(id);
        }
      }
    ),
    dialog?.kind === "rename-tab" && /* @__PURE__ */ jsx(
      NameDialog,
      {
        api: api2,
        title: "Rename Tab",
        initial: data.tabs.find((t) => t.id === dialog.id)?.name ?? "",
        onClose: () => setDialog(null),
        onSave: (name) => update((d) => ({ ...d, tabs: d.tabs.map((t) => t.id === dialog.id ? { ...t, name } : t) })),
        onDelete: data.tabs.length > 1 ? async () => {
          const name = data.tabs.find((t) => t.id === dialog.id)?.name ?? "";
          const ok = await api2.modal.confirm({
            title: "Delete Tab",
            message: `Permanently delete "${name}" and all of its items? This cannot be undone.`,
            confirmLabel: "Delete"
          });
          if (!ok) return false;
          const remaining = data.tabs.filter((t) => t.id !== dialog.id);
          if (activeTabId === dialog.id) setActiveTab(remaining[0].id);
          update((d) => ({
            ...d,
            tabs: d.tabs.filter((t) => t.id !== dialog.id),
            items: d.items.filter((i) => i.tabId !== dialog.id),
            schedules: (d.schedules ?? []).filter((s) => s.tabId !== dialog.id),
            tabOrder: reconcileOrder(d).filter((id) => id !== dialog.id)
          }));
          return true;
        } : void 0
      }
    ),
    dialog?.kind === "add-item" && /* @__PURE__ */ jsx(ItemDialog, { api: api2, tabId: activeTabId === COMBINED_ID ? data.tabs[0].id : activeTabId, width: Math.round((rootRef.current?.clientWidth ?? 0) / 2) - 34, onClose: () => setDialog(null) }),
    dialog?.kind === "schedule" && /* @__PURE__ */ jsx(
      ScheduleDialog,
      {
        api: api2,
        defaultTabId: activeTabId === COMBINED_ID ? data.tabs[0].id : activeTabId,
        width: Math.round((rootRef.current?.clientWidth ?? 0) / 2) - 34,
        maxHeight: Math.round((rootRef.current?.clientHeight ?? 0) * 0.8) - 60,
        onClose: () => setDialog(null)
      }
    )
  ] });
}
function ScheduleDialog(props) {
  const { api: api2, defaultTabId, width, maxHeight, onClose } = props;
  const { TextBox, TextButton, InlineDialog, Dropdown, DatePicker, TimePicker } = api2.ui;
  const palette = api2.theme.palette;
  const { data } = useSyncExternalStore(subscribe, getState);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriorityValue] = useState("none");
  const [repeat, setRepeat] = useState("once");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const schedules = (data.schedules ?? []).slice().sort((a, b) => a.nextAt - b.nextAt);
  const valid = !!title.trim() && !!date && !!time;
  const add = () => {
    if (!valid) return;
    const nextAt = toTimestamp(date, time);
    update((d) => ({
      ...d,
      schedules: [
        ...d.schedules ?? [],
        { id: newId(), tabId: defaultTabId, title: title.trim(), description, priority, repeat, nextAt, anchorDay: new Date(nextAt).getDate() }
      ]
    }));
    setTitle("");
    setDescription("");
    refresh();
  };
  const remove = async (id, name) => {
    const ok = await api2.modal.confirm({ title: "Delete Schedule", message: `Permanently delete "${name}"? This cannot be undone.`, confirmLabel: "Delete" });
    if (ok) update((d) => ({ ...d, schedules: (d.schedules ?? []).filter((s) => s.id !== id) }));
  };
  return /* @__PURE__ */ jsx(InlineDialog, { open: true, title: "Schedule", onClose, children: /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8, width, minHeight: maxHeight, maxHeight, overflow: "auto", scrollbarWidth: "thin", scrollbarColor: `${palette.border} ${palette.surface}` }, children: [
    /* @__PURE__ */ jsx("div", { onKeyDown: (e) => e.key === "Enter" && add(), children: /* @__PURE__ */ jsx(TextBox, { singleLine: true, value: title, onChange: setTitle, placeholder: "Title" }) }),
    /* @__PURE__ */ jsx(TextBox, { rows: 3, value: description, onChange: setDescription, placeholder: "Description (Optional)" }),
    /* @__PURE__ */ jsx("style", { children: `.agenda-grid > div { display: block !important; width: 100%; } .agenda-grid > div > button, .agenda-grid > input { width: 100%; }` }),
    /* @__PURE__ */ jsxs("div", { className: "agenda-grid", style: { display: "grid", gridTemplateColumns: "repeat(2, 160px)", gap: 8, justifyContent: "center" }, children: [
      /* @__PURE__ */ jsx(Dropdown, { options: repeatOptions, value: repeat, onChange: (v) => setRepeat(v) }),
      /* @__PURE__ */ jsx(Dropdown, { options: priorityOptions, value: priority, onChange: (v) => setPriorityValue(v) }),
      /* @__PURE__ */ jsx(DatePicker, { value: date, onChange: setDate, placeholder: "Pick A Date" }),
      /* @__PURE__ */ jsx(TimePicker, { value: time, onChange: setTime })
    ] }),
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" }, children: [
      /* @__PURE__ */ jsx(TextButton, { label: "Close", variant: "secondary", onClick: onClose }),
      /* @__PURE__ */ jsx(TextButton, { label: "Add Schedule", variant: "primary", disabled: !valid, onClick: add })
    ] }),
    /* @__PURE__ */ jsxs("div", { style: { borderTop: `1px solid ${palette.border}`, paddingTop: 8 }, children: [
      schedules.length === 0 && /* @__PURE__ */ jsx("div", { style: { color: palette.textMuted }, children: "No Schedules Yet" }),
      schedules.map((s) => /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: `1px solid ${palette.border}` }, children: [
        /* @__PURE__ */ jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [
          /* @__PURE__ */ jsx("div", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: s.title }),
          /* @__PURE__ */ jsxs("div", { style: { color: palette.textMuted }, children: [
            data.tabs.find((t) => t.id === s.tabId)?.name ?? "Unknown Tab",
            " \xB7 ",
            repeatLabel[s.repeat],
            " \xB7 ",
            new Date(s.nextAt).toLocaleString()
          ] })
        ] }),
        /* @__PURE__ */ jsx(TextButton, { label: "Delete", variant: "secondary", onClick: () => remove(s.id, s.title) })
      ] }, s.id))
    ] })
  ] }) });
}
function NameDialog(props) {
  const { TextBox, TextButton, InlineDialog } = props.api.ui;
  const [name, setName] = useState(props.initial);
  const save = () => {
    if (!name.trim()) return;
    props.onSave(name.trim());
    props.onClose();
  };
  return /* @__PURE__ */ jsx(InlineDialog, { open: true, title: props.title, onClose: props.onClose, children: /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, onKeyDown: (e) => e.key === "Enter" && save(), children: [
    /* @__PURE__ */ jsx(TextBox, { singleLine: true, value: name, onChange: setName, placeholder: "Name" }),
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" }, children: [
      props.onDelete && /* @__PURE__ */ jsx(TextButton, { label: "Delete Tab", variant: "secondary", onClick: async () => await props.onDelete() && props.onClose() }),
      /* @__PURE__ */ jsx(TextButton, { label: "Cancel", variant: "secondary", onClick: props.onClose }),
      /* @__PURE__ */ jsx(TextButton, { label: "Save", variant: "primary", disabled: !name.trim(), onClick: save })
    ] })
  ] }) });
}
function ItemDialog({ api: api2, tabId, width, onClose }) {
  const { TextBox, TextButton, InlineDialog, Dropdown } = api2.ui;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriorityValue] = useState("none");
  const add = () => {
    if (!title.trim()) return;
    const now = Date.now();
    update((d) => ({
      ...d,
      items: [...d.items, { id: newId(), tabId, title: title.trim(), description, priority, priorityAt: now, createdAt: now, done: false }]
    }));
    onClose();
  };
  return /* @__PURE__ */ jsx(InlineDialog, { open: true, title: "Add Item", onClose, children: /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8, width }, children: [
    /* @__PURE__ */ jsx("div", { onKeyDown: (e) => e.key === "Enter" && add(), children: /* @__PURE__ */ jsx(TextBox, { singleLine: true, value: title, onChange: setTitle, placeholder: "Title" }) }),
    /* @__PURE__ */ jsx(TextBox, { rows: 4, value: description, onChange: setDescription, placeholder: "Description (Optional)" }),
    /* @__PURE__ */ jsx(Dropdown, { options: priorityOptions, value: priority, onChange: (v) => setPriorityValue(v) }),
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end" }, children: [
      /* @__PURE__ */ jsx(TextButton, { label: "Cancel", variant: "secondary", onClick: onClose }),
      /* @__PURE__ */ jsx(TextButton, { label: "Add Item", variant: "primary", disabled: !title.trim(), onClick: add })
    ] })
  ] }) });
}
function Row({ api: api2, item }) {
  const { Checkbox, StatusDot, Menu, TextBox, TextButton, Dropdown } = api2.ui;
  const palette = api2.theme.palette;
  const [open, setOpen] = useState(false);
  const rowRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e) => {
      const row = rowRef.current;
      const target = e.target;
      if (!row || row.contains(target) || !row.closest("[data-agenda-root]")?.contains(target)) return;
      if (target.hasAttribute("data-agenda-list") && e.clientX - target.getBoundingClientRect().left >= target.clientWidth) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);
  const patch = (changes) => update((d) => ({ ...d, items: d.items.map((i) => i.id === item.id ? { ...i, ...changes } : i) }));
  const changePriority = (priority) => update((d) => ({ ...d, items: d.items.map((i) => i.id === item.id ? setPriority(i, priority, Date.now()) : i) }));
  const remove = async () => {
    const ok = await api2.modal.confirm({
      title: "Delete Item",
      message: `Permanently delete "${item.title}"? This cannot be undone.`,
      confirmLabel: "Delete"
    });
    if (ok) update((d) => ({ ...d, items: d.items.filter((i) => i.id !== item.id) }));
  };
  const dot = /* @__PURE__ */ jsx(StatusDot, { color: statusFor(item.priority) });
  return /* @__PURE__ */ jsxs("div", { ref: rowRef, style: { padding: "4px 8px", borderBottom: `1px solid ${palette.border}`, color: item.done ? palette.textMuted : palette.text }, children: [
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, minHeight: 32 }, children: [
      item.done ? dot : /* @__PURE__ */ jsx(
        Menu,
        {
          trigger: dot,
          items: PRIORITIES.slice().reverse().map((p) => ({ label: priorityLabel[p], onClick: () => changePriority(p) }))
        }
      ),
      /* @__PURE__ */ jsx(
        Checkbox,
        {
          checked: item.done,
          onChange: (checked) => update((d) => ({ ...d, items: d.items.map((i) => i.id === item.id ? setDone(i, checked, Date.now()) : i) }))
        }
      ),
      open ? /* @__PURE__ */ jsx("div", { style: { flex: 1, minWidth: 0 }, children: /* @__PURE__ */ jsx(TextBox, { singleLine: true, value: item.title, onChange: (title) => patch({ title }), placeholder: "Title" }) }) : /* @__PURE__ */ jsx("div", { style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: item.done ? "line-through" : void 0 }, children: item.title }),
      /* @__PURE__ */ jsx(TextButton, { label: open ? "\u25B4" : "\u25BE", bordered: false, onClick: () => setOpen(!open) })
    ] }),
    open && /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8, padding: "4px 0 8px" }, children: [
      /* @__PURE__ */ jsx(TextBox, { rows: 4, value: item.description, onChange: (description) => patch({ description }), placeholder: "Description" }),
      /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }, children: [
        /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
          /* @__PURE__ */ jsx("span", { children: "Priority: " }),
          /* @__PURE__ */ jsx(Dropdown, { options: priorityOptions, value: item.priority, onChange: (v) => changePriority(v) })
        ] }),
        /* @__PURE__ */ jsx(TextButton, { label: "Delete", variant: "secondary", onClick: remove })
      ] })
    ] })
  ] });
}
export {
  Component,
  activate
};
//# sourceMappingURL=index.js.map

// index.tsx
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// model.ts
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
  sortAfterPriority: "createdAsc"
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
function moveTab(tabs, fromId, toId) {
  const from = tabs.findIndex((t) => t.id === fromId);
  const to = tabs.findIndex((t) => t.id === toId);
  if (from < 0 || to < 0 || from === to) return tabs;
  const next = tabs.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
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
      sortAfterPriority: SORT_ORDERS.includes(parsed.sortAfterPriority) ? parsed.sortAfterPriority : DEFAULT_SETTINGS.sortAfterPriority
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
  const data = stored?.tabs?.length ? stored : { tabs: [{ id: newId(), name: "General" }], items: stored?.items ?? [] };
  set({ data, activeTabId: data.tabs[0].id, settings });
  refresh();
}
async function reloadSettings() {
  set({ ...state, settings: await loadSettings("agenda") });
  refresh();
}
function refresh() {
  const now = Date.now();
  const items = purgeDone(escalate(state.data.items, now), now, state.settings.completedRetentionDays);
  const changed = items.length !== state.data.items.length || items.some((item, i) => item !== state.data.items[i]);
  if (changed) update((data) => ({ ...data, items }));
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
var HOUR_MS = 60 * 60 * 1e3;
var TAB_DRAG_TYPE = "application/x-agenda-tab";
async function activate(ctx) {
  await init(ctx.api);
  ctx.tick.register(() => refresh());
  ctx.tick.setInterval(HOUR_MS);
  ctx.tick.requestWake(2e3);
  ctx.onDispose(flush);
}
var priorityOptions = PRIORITIES.slice().reverse().map((p) => ({ label: priorityLabel[p], value: p }));
function Component({ api: api2 }) {
  const { data, activeTabId, settings } = useSyncExternalStore(subscribe, getState);
  const palette = api2.theme.palette;
  const { TextButton, StatusDot } = api2.ui;
  const [dialog, setDialog] = useState(null);
  const [dragId, setDragId] = useState(null);
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
  const tabItems = data.items.filter((i) => i.tabId === activeTabId);
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
  return /* @__PURE__ */ jsxs("div", { ref: rootRef, style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 8, position: "relative" }, children: [
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${palette.border}` }, children: [
      /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", flex: 1, minWidth: 0, overflowX: "auto" }, children: [
        data.tabs.map((tab) => /* @__PURE__ */ jsx(
          "div",
          {
            draggable: true,
            style: tabStyle(tab.id === activeTabId),
            onClick: () => setActiveTab(tab.id),
            onContextMenu: (e) => {
              e.preventDefault();
              setDialog({ kind: "rename-tab", id: tab.id });
            },
            onDragStart: (e) => {
              e.dataTransfer.setData(TAB_DRAG_TYPE, tab.id);
              e.dataTransfer.effectAllowed = "move";
              setDragId(tab.id);
            },
            onDragEnter: stopDrag,
            onDragOver: stopDrag,
            onDrop: (e) => {
              stopDrag(e);
              if (dragId) update((d) => ({ ...d, tabs: moveTab(d.tabs, dragId, tab.id) }));
              setDragId(null);
            },
            onDragEnd: () => setDragId(null),
            children: /* @__PURE__ */ jsxs("span", { style: { display: "inline-flex", alignItems: "center", gap: 6 }, children: [
              /* @__PURE__ */ jsx(StatusDot, { color: statusFor(topPriority(data.items.filter((i) => i.tabId === tab.id), settings.reportedPriorities)) }),
              tab.name
            ] })
          },
          tab.id
        )),
        /* @__PURE__ */ jsx(TextButton, { label: "+", bordered: false, onClick: () => setDialog({ kind: "add-tab" }) })
      ] }),
      /* @__PURE__ */ jsx(TextButton, { label: "Add Item", variant: "primary", onClick: () => setDialog({ kind: "add-item" }) })
    ] }),
    /* @__PURE__ */ jsxs("div", { style: { flex: 1, minHeight: 0, overflow: "auto", scrollbarWidth: "thin", scrollbarColor: `${palette.border} ${palette.surface}` }, children: [
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
          update((d) => ({ ...d, tabs: [...d.tabs, { id, name }] }));
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
        onSave: (name) => update((d) => ({ ...d, tabs: d.tabs.map((t) => t.id === dialog.id ? { ...t, name } : t) }))
      }
    ),
    dialog?.kind === "add-item" && /* @__PURE__ */ jsx(ItemDialog, { api: api2, tabId: activeTabId, width: Math.round((rootRef.current?.clientWidth ?? 0) / 2) - 34, onClose: () => setDialog(null) })
  ] });
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
  return /* @__PURE__ */ jsxs("div", { style: { padding: "4px 8px", borderBottom: `1px solid ${palette.border}`, color: item.done ? palette.textMuted : palette.text }, children: [
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

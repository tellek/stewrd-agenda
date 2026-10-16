import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import type { PluginApi, PluginContext } from "stewrd-plugin-api";
import { COMBINED_ID, PRIORITIES, itemsForTab, moveTabBefore, orderedTabs, priorityLabel, reconcileOrder, repeatLabel, setDone, setPriority, sortActive, sortDone, statusFor, toTimestamp, topPriority } from "./model.ts";
import type { Item, Priority, Repeat } from "./model.ts";
import { flush, getState, init, newId, refresh, reloadSettings, setActiveTab, subscribe, update } from "./store.ts";
import { setViewing } from "./status.ts";

const TICK_MS = 60 * 1000;
const TAB_DRAG_TYPE = "application/x-agenda-tab";

export async function activate(ctx: PluginContext) {
  await init(ctx.api);
  ctx.tick.register(() => refresh());
  ctx.tick.setInterval(TICK_MS);
  // statusIcon.set is a no-op until the host registers this plugin, so republish shortly after startup.
  ctx.tick.requestWake(2000);
  ctx.onDispose(flush);
}

const priorityOptions = PRIORITIES.slice().reverse().map((p) => ({ label: priorityLabel[p], value: p }));

const repeatOptions = (Object.keys(repeatLabel) as Repeat[]).map((r) => ({ label: repeatLabel[r], value: r }));

type Dialog = { kind: "add-tab" } | { kind: "rename-tab"; id: string } | { kind: "add-item" } | { kind: "schedule" } | null;

export function Component({ api }: { api: PluginApi }) {
  const { data, activeTabId, settings } = useSyncExternalStore(subscribe, getState);
  const palette = api.theme.palette;
  const { TextButton, StatusDot } = api.ui;
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null | undefined>(undefined); // undefined: no drop target
  const rootRef = useRef<HTMLDivElement>(null);
  const [, setThemeVersion] = useState(0); // re-render on theme switches

  useEffect(() => {
    setViewing(true);
    reloadSettings();
    const unsubscribe = api.theme.subscribe(() => setThemeVersion((v) => v + 1));
    return () => {
      setViewing(false);
      unsubscribe();
    };
  }, [api]);

  const tabs = orderedTabs(data, settings.showCombinedTab);
  const tabItems = itemsForTab(data.items, activeTabId);
  const active = sortActive(tabItems, settings.sortAfterPriority);
  const done = sortDone(tabItems);

  const tabStyle = (selected: boolean): CSSProperties => ({
    padding: "6px 12px",
    cursor: "pointer",
    userSelect: "none",
    color: selected ? palette.accent : palette.textMuted,
    borderBottom: `2px solid ${selected ? palette.accent : "transparent"}`,
  });

  const stopDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation(); // the host pane has its own drop handlers
  };

  const endDrag = () => {
    setDragId(null);
    setDropBefore(undefined);
  };

  const dropTab = (e: React.DragEvent) => {
    stopDrag(e);
    if (dragId && dropBefore !== undefined) update((d) => ({ ...d, tabOrder: moveTabBefore(reconcileOrder(d), dragId, dropBefore) }));
    endDrag();
  };

  const pipe = <div style={{ width: 2, alignSelf: "stretch", background: palette.accent, flexShrink: 0 }} />;

  return (
    <div ref={rootRef} data-agenda-root style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 8, position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${palette.border}` }}>
        <div
          style={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0, overflowX: "auto" }}
          onDragEnter={stopDrag}
          onDragOver={(e) => {
            stopDrag(e);
            if (dragId) setDropBefore(null); // over the empty strip: drop at the end
          }}
          onDrop={dropTab}
        >
          {tabs.map((tab, index) => (
            <Fragment key={tab.id}>
              {dragId && dropBefore === tab.id && pipe}
              <div
                draggable
                style={tabStyle(tab.id === activeTabId)}
                onClick={() => setActiveTab(tab.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (tab.id !== COMBINED_ID) setDialog({ kind: "rename-tab", id: tab.id });
                }}
                onDragStart={(e) => {
                  e.dataTransfer.setData(TAB_DRAG_TYPE, tab.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDragId(tab.id);
                }}
                onDragEnter={stopDrag}
                onDragOver={(e) => {
                  stopDrag(e);
                  if (!dragId) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  setDropBefore(e.clientX < rect.left + rect.width / 2 ? tab.id : (tabs[index + 1]?.id ?? null));
                }}
                onDrop={dropTab}
                onDragEnd={endDrag}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <StatusDot color={statusFor(topPriority(itemsForTab(data.items, tab.id), settings.reportedPriorities))} />
                  {tab.name}
                </span>
              </div>
            </Fragment>
          ))}
          {dragId && dropBefore === null && pipe}
          <TextButton label="+" bordered={false} onClick={() => setDialog({ kind: "add-tab" })} />
        </div>
        <TextButton label="Add Item" variant="primary" onClick={() => setDialog({ kind: "add-item" })} />
        <TextButton label="Schedule" variant="secondary" onClick={() => setDialog({ kind: "schedule" })} />
      </div>

      <div data-agenda-list style={{ flex: 1, minHeight: 0, overflow: "auto", scrollbarWidth: "thin", scrollbarColor: `${palette.border} ${palette.surface}` }}>
        {active.map((item) => (
          <Row key={item.id} api={api} item={item} />
        ))}
        {active.length === 0 && <div style={{ color: palette.textMuted, padding: 8 }}>Nothing To Do</div>}
        {done.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div style={{ color: palette.textMuted, padding: "4px 8px" }}>Completed</div>
            {done.map((item) => (
              <Row key={item.id} api={api} item={item} />
            ))}
          </div>
        )}
      </div>

      {dialog?.kind === "add-tab" && (
        <NameDialog
          api={api}
          title="Add Tab"
          initial=""
          onClose={() => setDialog(null)}
          onSave={(name) => {
            const id = newId();
            update((d) => ({ ...d, tabs: [...d.tabs, { id, name }], tabOrder: [...reconcileOrder(d), id] }));
            setActiveTab(id);
          }}
        />
      )}
      {dialog?.kind === "rename-tab" && (
        <NameDialog
          api={api}
          title="Rename Tab"
          initial={data.tabs.find((t) => t.id === dialog.id)?.name ?? ""}
          onClose={() => setDialog(null)}
          onSave={(name) => update((d) => ({ ...d, tabs: d.tabs.map((t) => (t.id === dialog.id ? { ...t, name } : t)) }))}
          onDelete={
            data.tabs.length > 1
              ? async () => {
                  const name = data.tabs.find((t) => t.id === dialog.id)?.name ?? "";
                  const ok = await api.modal.confirm({
                    title: "Delete Tab",
                    message: `Permanently delete "${name}" and all of its items? This cannot be undone.`,
                    confirmLabel: "Delete",
                  });
                  if (!ok) return false;
                  const remaining = data.tabs.filter((t) => t.id !== dialog.id);
                  if (activeTabId === dialog.id) setActiveTab(remaining[0].id);
                  update((d) => ({
                    ...d,
                    tabs: d.tabs.filter((t) => t.id !== dialog.id),
                    items: d.items.filter((i) => i.tabId !== dialog.id),
                    schedules: (d.schedules ?? []).filter((s) => s.tabId !== dialog.id),
                    tabOrder: reconcileOrder(d).filter((id) => id !== dialog.id),
                  }));
                  return true;
                }
              : undefined
          }
        />
      )}
      {dialog?.kind === "add-item" && <ItemDialog api={api} tabId={activeTabId === COMBINED_ID ? data.tabs[0].id : activeTabId}width={Math.round((rootRef.current?.clientWidth ?? 0) / 2) - 34} onClose={() => setDialog(null)} />}
      {dialog?.kind === "schedule" && (
        <ScheduleDialog
          api={api}
          defaultTabId={activeTabId === COMBINED_ID ? data.tabs[0].id : activeTabId}
          width={Math.round((rootRef.current?.clientWidth ?? 0) / 2) - 34}
          maxHeight={Math.round((rootRef.current?.clientHeight ?? 0) * 0.8) - 60}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function ScheduleDialog(props: { api: PluginApi; defaultTabId: string; width: number; maxHeight: number; onClose: () => void }) {
  const { api, defaultTabId, width, maxHeight, onClose } = props;
  const { TextBox, TextButton, InlineDialog, Dropdown, DatePicker, TimePicker } = api.ui;
  const palette = api.theme.palette;
  const { data } = useSyncExternalStore(subscribe, getState);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriorityValue] = useState<Priority>("none");
  const [repeat, setRepeat] = useState<Repeat>("once");
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
        ...(d.schedules ?? []),
        { id: newId(), tabId: defaultTabId, title: title.trim(), description, priority, repeat, nextAt, anchorDay: new Date(nextAt).getDate() },
      ],
    }));
    setTitle("");
    setDescription("");
    refresh(); // a start time already in the past fires right away
  };
  const remove = async (id: string, name: string) => {
    const ok = await api.modal.confirm({ title: "Delete Schedule", message: `Permanently delete "${name}"? This cannot be undone.`, confirmLabel: "Delete" });
    if (ok) update((d) => ({ ...d, schedules: (d.schedules ?? []).filter((s) => s.id !== id) }));
  };

  return (
    <InlineDialog open title="Schedule" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, width, minHeight: maxHeight, maxHeight, overflow: "auto", scrollbarWidth: "thin", scrollbarColor: `${palette.border} ${palette.surface}` }}>
        <div onKeyDown={(e) => e.key === "Enter" && add()}>
          <TextBox singleLine value={title} onChange={setTitle} placeholder="Title" />
        </div>
        <TextBox rows={3} value={description} onChange={setDescription} placeholder="Description (Optional)" />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Dropdown options={repeatOptions} value={repeat} onChange={(v) => setRepeat(v as Repeat)} />
          <Dropdown options={priorityOptions} value={priority} onChange={(v) => setPriorityValue(v as Priority)} />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <DatePicker value={date} onChange={setDate} placeholder="Pick A Date" />
          <TimePicker value={time} onChange={setTime} />
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <TextButton label="Close" variant="secondary" onClick={onClose} />
          <TextButton label="Add Schedule" variant="primary" disabled={!valid} onClick={add} />
        </div>
        <div style={{ borderTop: `1px solid ${palette.border}`, paddingTop: 8 }}>
          {schedules.length === 0 && <div style={{ color: palette.textMuted }}>No Schedules Yet</div>}
          {schedules.map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: `1px solid ${palette.border}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>
                <div style={{ color: palette.textMuted }}>
                  {data.tabs.find((t) => t.id === s.tabId)?.name ?? "Unknown Tab"} · {repeatLabel[s.repeat]} · {new Date(s.nextAt).toLocaleString()}
                </div>
              </div>
              <TextButton label="Delete" variant="secondary" onClick={() => remove(s.id, s.title)} />
            </div>
          ))}
        </div>
      </div>
    </InlineDialog>
  );
}

function NameDialog(props: { api: PluginApi; title: string; initial: string; onClose: () => void; onSave: (name: string) => void; onDelete?: () => Promise<boolean> }) {
  const { TextBox, TextButton, InlineDialog } = props.api.ui;
  const [name, setName] = useState(props.initial);
  const save = () => {
    if (!name.trim()) return;
    props.onSave(name.trim());
    props.onClose();
  };
  return (
    <InlineDialog open title={props.title} onClose={props.onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }} onKeyDown={(e) => e.key === "Enter" && save()}>
        <TextBox singleLine value={name} onChange={setName} placeholder="Name" />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {props.onDelete && (
            <TextButton label="Delete Tab" variant="secondary" onClick={async () => (await props.onDelete!()) && props.onClose()} />
          )}
          <TextButton label="Cancel" variant="secondary" onClick={props.onClose} />
          <TextButton label="Save" variant="primary" disabled={!name.trim()} onClick={save} />
        </div>
      </div>
    </InlineDialog>
  );
}

function ItemDialog({ api, tabId, width, onClose }: { api: PluginApi; tabId: string; width: number; onClose: () => void }) {
  const { TextBox, TextButton, InlineDialog, Dropdown } = api.ui;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriorityValue] = useState<Priority>("none");
  const add = () => {
    if (!title.trim()) return;
    const now = Date.now();
    update((d) => ({
      ...d,
      items: [...d.items, { id: newId(), tabId, title: title.trim(), description, priority, priorityAt: now, createdAt: now, done: false }],
    }));
    onClose();
  };
  return (
    <InlineDialog open title="Add Item" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, width }}>
        <div onKeyDown={(e) => e.key === "Enter" && add()}>
          <TextBox singleLine value={title} onChange={setTitle} placeholder="Title" />
        </div>
        <TextBox rows={4} value={description} onChange={setDescription} placeholder="Description (Optional)" />
        <Dropdown options={priorityOptions} value={priority} onChange={(v) => setPriorityValue(v as Priority)} />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <TextButton label="Cancel" variant="secondary" onClick={onClose} />
          <TextButton label="Add Item" variant="primary" disabled={!title.trim()} onClick={add} />
        </div>
      </div>
    </InlineDialog>
  );
}

function Row({ api, item }: { api: PluginApi; item: Item }) {
  const { Checkbox, StatusDot, Menu, TextBox, TextButton, Dropdown } = api.ui;
  const palette = api.theme.palette;
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  // Collapse on a click outside the row. Clicks outside the plugin (host modals) and on the list's scrollbar don't count.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const row = rowRef.current;
      const target = e.target as Element;
      if (!row || row.contains(target) || !row.closest("[data-agenda-root]")?.contains(target)) return;
      if (target.hasAttribute("data-agenda-list") && e.clientX - target.getBoundingClientRect().left >= target.clientWidth) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const patch = (changes: Partial<Item>) =>
    update((d) => ({ ...d, items: d.items.map((i) => (i.id === item.id ? { ...i, ...changes } : i)) }));
  const changePriority = (priority: Priority) =>
    update((d) => ({ ...d, items: d.items.map((i) => (i.id === item.id ? setPriority(i, priority, Date.now()) : i)) }));
  const remove = async () => {
    const ok = await api.modal.confirm({
      title: "Delete Item",
      message: `Permanently delete "${item.title}"? This cannot be undone.`,
      confirmLabel: "Delete",
    });
    if (ok) update((d) => ({ ...d, items: d.items.filter((i) => i.id !== item.id) }));
  };
  const dot = <StatusDot color={statusFor(item.priority)} />;

  return (
    <div ref={rowRef} style={{ padding: "4px 8px", borderBottom: `1px solid ${palette.border}`, color: item.done ? palette.textMuted : palette.text }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 32 }}>
        {item.done ? (
          dot
        ) : (
          <Menu
            trigger={dot}
            items={PRIORITIES.slice().reverse().map((p) => ({ label: priorityLabel[p], onClick: () => changePriority(p) }))}
          />
        )}
        <Checkbox
          checked={item.done}
          onChange={(checked) =>
            update((d) => ({ ...d, items: d.items.map((i) => (i.id === item.id ? setDone(i, checked, Date.now()) : i)) }))
          }
        />
        {open ? (
          <div style={{ flex: 1, minWidth: 0 }}>
            <TextBox singleLine value={item.title} onChange={(title) => patch({ title })} placeholder="Title" />
          </div>
        ) : (
          <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: item.done ? "line-through" : undefined }}>
            {item.title}
          </div>
        )}
        <TextButton label={open ? "▴" : "▾"} bordered={false} onClick={() => setOpen(!open)} />
      </div>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0 8px" }}>
          <TextBox rows={4} value={item.description} onChange={(description) => patch({ description })} placeholder="Description" />
          <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span>Priority: </span>
              <Dropdown options={priorityOptions} value={item.priority} onChange={(v) => changePriority(v as Priority)} />
            </div>
            <TextButton label="Delete" variant="secondary" onClick={remove} />
          </div>
        </div>
      )}
    </div>
  );
}

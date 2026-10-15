import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import type { PluginApi, PluginContext } from "stewrd-plugin-api";
import { PRIORITIES, moveTab, priorityLabel, setDone, setPriority, sortActive, sortDone, statusFor, topPriority } from "./model.ts";
import type { Item, Priority } from "./model.ts";
import { flush, getState, init, newId, publish, refresh, setActiveTab, subscribe, update } from "./store.ts";
import { setViewing } from "./status.ts";

const HOUR_MS = 60 * 60 * 1000;
const TAB_DRAG_TYPE = "application/x-agenda-tab";

export async function activate(ctx: PluginContext) {
  await init(ctx.api);
  ctx.tick.register(() => refresh());
  ctx.tick.setInterval(HOUR_MS);
  // statusIcon.set is a no-op until the host registers this plugin, so republish shortly after startup.
  ctx.tick.requestWake(2000);
  ctx.onDispose(flush);
}

const priorityOptions = PRIORITIES.slice().reverse().map((p) => ({ label: priorityLabel[p], value: p }));

type Dialog = { kind: "add-tab" } | { kind: "rename-tab"; id: string } | { kind: "add-item" } | null;

export function Component({ api }: { api: PluginApi }) {
  const { data, activeTabId } = useSyncExternalStore(subscribe, getState);
  const palette = api.theme.palette;
  const { TextButton, StatusDot } = api.ui;
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [, setThemeVersion] = useState(0); // re-render on theme switches

  useEffect(() => {
    setViewing(true);
    publish();
    const unsubscribe = api.theme.subscribe(() => setThemeVersion((v) => v + 1));
    return () => {
      setViewing(false);
      unsubscribe();
    };
  }, [api]);

  const tabItems = data.items.filter((i) => i.tabId === activeTabId);
  const active = sortActive(tabItems);
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

  return (
    <div ref={rootRef} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 8, position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${palette.border}` }}>
        <div style={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0, overflowX: "auto" }}>
          {data.tabs.map((tab) => (
            <div
              key={tab.id}
              draggable
              style={tabStyle(tab.id === activeTabId)}
              onClick={() => setActiveTab(tab.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setDialog({ kind: "rename-tab", id: tab.id });
              }}
              onDragStart={(e) => {
                e.dataTransfer.setData(TAB_DRAG_TYPE, tab.id);
                e.dataTransfer.effectAllowed = "move";
                setDragId(tab.id);
              }}
              onDragEnter={stopDrag}
              onDragOver={stopDrag}
              onDrop={(e) => {
                stopDrag(e);
                if (dragId) update((d) => ({ ...d, tabs: moveTab(d.tabs, dragId, tab.id) }));
                setDragId(null);
              }}
              onDragEnd={() => setDragId(null)}
            >
              {tab.name}
            </div>
          ))}
          <TextButton label="+" bordered={false} onClick={() => setDialog({ kind: "add-tab" })} />
        </div>
        <StatusDot color={statusFor(topPriority(tabItems))} />
        <TextButton label="Add Item" variant="primary" onClick={() => setDialog({ kind: "add-item" })} />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", scrollbarWidth: "thin", scrollbarColor: `${palette.border} ${palette.surface}` }}>
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
            update((d) => ({ ...d, tabs: [...d.tabs, { id, name }] }));
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
        />
      )}
      {dialog?.kind === "add-item" && <ItemDialog api={api} tabId={activeTabId} width={Math.round((rootRef.current?.clientWidth ?? 0) / 2) - 34} onClose={() => setDialog(null)} />}
    </div>
  );
}

function NameDialog(props: { api: PluginApi; title: string; initial: string; onClose: () => void; onSave: (name: string) => void }) {
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
    <div style={{ padding: "4px 8px", borderBottom: `1px solid ${palette.border}`, color: item.done ? palette.textMuted : palette.text }}>
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

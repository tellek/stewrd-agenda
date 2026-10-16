// Options live in this plugin's own settings.json (Settings > Plugins >
// Configure). `read_plugin_settings_file` is an existing host command.
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_SETTINGS, PRIORITIES } from "./model.ts";
import type { Priority, Settings, SortOrder } from "./model.ts";

const SORT_ORDERS: SortOrder[] = ["createdAsc", "createdDesc", "titleAsc", "titleDesc"];

export async function loadSettings(pluginId: string): Promise<Settings> {
  try {
    const parsed = JSON.parse(await invoke<string>("read_plugin_settings_file", { dir: pluginId })) as Partial<Settings>;
    const days = parsed.completedRetentionDays;
    return {
      completedRetentionDays: typeof days === "number" && days >= 0 ? days : DEFAULT_SETTINGS.completedRetentionDays,
      reportedPriorities: Array.isArray(parsed.reportedPriorities)
        ? parsed.reportedPriorities.filter((p): p is Priority => PRIORITIES.includes(p))
        : DEFAULT_SETTINGS.reportedPriorities,
      sortAfterPriority: SORT_ORDERS.includes(parsed.sortAfterPriority as SortOrder)
        ? (parsed.sortAfterPriority as SortOrder)
        : DEFAULT_SETTINGS.sortAfterPriority,
      showCombinedTab: typeof parsed.showCombinedTab === "boolean" ? parsed.showCombinedTab : DEFAULT_SETTINGS.showCombinedTab,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

# Agenda

A Stewrd plugin for tabbed to-do and agenda lists.

- Tabs: `+` adds one, right-click renames, drag to reorder (a vertical bar marks where the tab will land). Tab order and the selected tab are saved automatically.
- Schedule: the Schedule button creates items that appear on the board at a set date and time, once or repeating daily, weekly or monthly, and lists existing schedules for deletion.
- Delete tab: right-click a tab and choose Delete Tab to remove it with its items and schedules (the last tab cannot be deleted).
- Combined tab: with more than one tab, a Combined tab at the left shows every item. Turn it off with `showCombinedTab`.
- Click anywhere outside an expanded item to collapse it.
- Items: title, optional description and priority. Check the box to complete; completed items sit greyed at the bottom for 30 days and can be restored.
- Click the priority dot to change priority quickly. Expand a row to edit everything (autosaved) or delete it permanently.
- Priorities escalate automatically: High is immediate, Medium becomes High after a day, Normal becomes Medium after a week, None becomes Normal after a month.
- each tab has its own status dot, and the sidebar icon follows the highest open priority: High is error, Medium is warning, Normal is in-progress, None is idle.

## Development

```
npm install
npm test
npm run build
./build-release.bat
```

## Settings

Edit via Settings > Plugins > Configure (`settings.json`). Changes apply the next time the pane opens.

| Key | Default | Meaning |
|---|---|---|
| `completedRetentionDays` | `30` | Days a completed item is kept before it is deleted |
| `reportedPriorities` | `["normal", "medium", "high"]` | Priorities that color the sidebar icon and tab dots (`none`, `normal`, `medium`, `high`) |
| `sortAfterPriority` | `"createdAsc"` | Order within a priority: `createdAsc`, `createdDesc`, `titleAsc`, `titleDesc` |
| `showCombinedTab` | `true` | Show a Combined tab with all items when there is more than one tab |

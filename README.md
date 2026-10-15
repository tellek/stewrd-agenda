# Agenda

A Stewrd plugin for tabbed to-do and agenda lists.

- Tabs: `+` adds one, right-click renames, drag to reorder.
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

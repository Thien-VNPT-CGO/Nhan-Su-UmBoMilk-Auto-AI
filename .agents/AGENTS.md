# AGENTS.md - Workspace Rules

## Mandatory User Approval Before Git Push
- **Present Plan & Preview First**: Whenever the user requests a new feature, UI/UX modification, or bug fix, you MUST present a detailed implementation plan / visual preview for the user to review first.
- **Wait for Explicit Approval**: You MUST wait for the user's explicit approval before running `git push` or deploying any changes to GitHub/production.

## Mandatory Realtime Data Execution
- **Realtime By Default**: Always execute and update data in real-time. Any state mutation (shifts, training, candidates, attendance) must immediately trigger backend Socket event emissions (`shift:updated`, `candidate:updated`, `training:updated`, `attendance:updated`) and push instant UI updates to all connected clients without requiring manual page reloads or button clicks.


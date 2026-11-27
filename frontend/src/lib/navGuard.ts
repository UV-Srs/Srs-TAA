/**
 * A tiny "are you sure you want to leave?" hook for in-app navigation.
 *
 * A screen with unsaved work registers a guard. Whoever navigates (sidebar, header, logout, ...)
 * goes through guardedNavigate(). If a guard is registered it may take over: it returns true,
 * shows its own confirmation, and calls `proceed` itself if the user chooses to leave.
 * Closing or reloading the browser tab is handled separately with `beforeunload`.
 */
export type NavGuard = (proceed: () => void) => boolean;

let current: NavGuard | null = null;

export function registerNavGuard(guard: NavGuard): () => void {
  current = guard;
  return () => {
    if (current === guard) current = null;
  };
}

export function guardedNavigate(proceed: () => void): void {
  if (current && current(proceed)) return;
  proceed();
}

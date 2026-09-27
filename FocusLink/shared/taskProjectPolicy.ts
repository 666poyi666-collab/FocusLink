export const FOCUSLINK_INBOX_PROJECT_ID = 'local-inbox' as const;

export const TASK_PROJECT_COLOR_PALETTE = [
  '#16899f',
  '#2f6fed',
  '#7957c7',
  '#c56a2d',
  '#b94a5a',
  '#4b8b5a',
  '#59636f',
] as const;

export type TaskProjectColor = (typeof TASK_PROJECT_COLOR_PALETTE)[number];

export function isFocusLinkInboxProject(projectId: string | null | undefined): boolean {
  return projectId === FOCUSLINK_INBOX_PROJECT_ID;
}

export function defaultTaskProjectColor(projectCount: number): TaskProjectColor {
  const index = Math.max(0, Math.floor(projectCount));
  return TASK_PROJECT_COLOR_PALETTE[index % TASK_PROJECT_COLOR_PALETTE.length];
}

export function normalizeTaskProjectColor(value: string | null | undefined): string {
  if (!value) return TASK_PROJECT_COLOR_PALETTE[0];
  const normalized = value.trim().toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized)) {
    return normalized;
  }
  return TASK_PROJECT_COLOR_PALETTE[0];
}

export const AUTOMATION_PLUGIN_ID = 'local.automation';

export type AutomationCommandSource = 'system' | 'custom';
export type AutomationShell = 'cmd' | 'powershell';
export type AutomationArgMode = 'none' | 'optional' | 'required';
export type AutomationCommandGroup = 'network' | 'text' | 'util' | 'custom';

export interface AutomationCommand {
  id: string;
  /** The word typed in the search bar, e.g. "ping" */
  token: string;
  name: string;
  description: string;
  aliases: string[];
  argHint: string;
  argMode: AutomationArgMode;
  group: AutomationCommandGroup;
  source: AutomationCommandSource;
  /** Built-in script identifier (system commands only) */
  builtinId?: string;
  /** Shell used for custom scripts */
  shell?: AutomationShell;
  script?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  usageCount: number;
  lastRunAt: number | null;
}

/** The trimmed shape exposed to the Search Bar. */
export interface AutomationSearchCommand {
  id: string;
  token: string;
  name: string;
  description: string;
  aliases: string[];
  argHint: string;
  argMode: AutomationArgMode;
}

export interface AutomationCommandInput {
  id?: string;
  token: string;
  name: string;
  description: string;
  aliases: string[];
  argHint: string;
  argMode: AutomationArgMode;
  shell: AutomationShell;
  script: string;
  enabled?: boolean;
}

export type AutomationRunStatus = 'running' | 'success' | 'error';
export type AutomationRunTrigger = 'search' | 'panel';

export interface AutomationRun {
  id: string;
  commandId: string;
  token: string;
  name: string;
  args: string;
  commandLine: string;
  status: AutomationRunStatus;
  output: string;
  error?: string;
  exitCode?: number | null;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  autoCopied: boolean;
  trigger: AutomationRunTrigger;
}

export interface AutomationSettings {
  autoCopy: boolean;
}

export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  autoCopy: true,
};

export interface AutomationStartResult {
  runId: string;
}

import type { AutomationSearchCommand, PluginCategory, SearchItem } from '@shared';

export interface SearchableTool {
  id: string;
  name: string;
  desc: string;
  icon?: string;
  keywords: string[];
  category: PluginCategory;
}

const SHOW_ALL_QUERIES = new Set(['全部', '所有', 'all']);

function scoreField(value: string | undefined, query: string, weight: number): number {
  if (!value) return 0;
  const normalized = value.toLowerCase();
  if (normalized === query) return weight * 3;
  if (normalized.startsWith(query)) return weight * 2;
  if (normalized.includes(query)) return weight;
  return 0;
}

function toResult(tool: SearchableTool, score: number): SearchItem {
  return {
    pluginId: tool.id,
    title: tool.name,
    subtitle: tool.desc,
    icon: tool.icon,
    category: tool.category,
    score,
  };
}

export function searchTools(tools: SearchableTool[], rawQuery: string): SearchItem[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];

  if (SHOW_ALL_QUERIES.has(query)) {
    return tools.map((tool) => toResult(tool, 0));
  }

  const results: SearchItem[] = [];
  for (const tool of tools) {
    const score = Math.max(
      scoreField(tool.name, query, 3),
      scoreField(tool.id, query, 2),
      ...tool.keywords.map((keyword) => scoreField(keyword, query, 2)),
      scoreField(tool.desc, query, 1),
    );
    if (score > 0) results.push(toResult(tool, score));
  }

  results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return results;
}

export const AUTOMATION_ITEM_PREFIX = '__automation__:';

/**
 * Inline automation commands: typing the command token plus arguments turns
 * into a one-Enter action. Exact token matches always rank above plugins;
 * incomplete prefix matches stay discoverable but sit below strong plugin hits.
 */
export function searchAutomation(
  commands: AutomationSearchCommand[],
  rawQuery: string,
): SearchItem[] {
  const query = rawQuery.trim();
  if (!query) return [];
  const match = query.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return [];
  const token = match[1].toLowerCase();
  const args = (match[2] ?? '').trim();
  const results: SearchItem[] = [];

  for (const command of commands) {
    const keys = [command.token, ...command.aliases].map((key) => key.toLowerCase());
    const exact = keys.includes(token);
    const prefix = !args && keys.some((key) => key.startsWith(token));
    if (!exact && !prefix) continue;

    const hint =
      command.argMode === 'required'
        ? `需要参数：${command.argHint || '参数'}`
        : command.argHint
          ? `参数：${command.argHint}`
          : '直接执行';
    results.push({
      pluginId: `${AUTOMATION_ITEM_PREFIX}${command.id}`,
      title: command.name,
      subtitle: `自动化 · ${command.token}${args ? ` ${args}` : ''} · ${hint} · Enter 执行`,
      category: 'system',
      score: exact ? 3000 : 6,
      automation: { commandId: command.id, args },
    });
  }

  results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return results;
}

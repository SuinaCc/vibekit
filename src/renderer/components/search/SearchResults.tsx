import { For } from 'solid-js';
import ResultItem from './ResultItem';
import type { MenuItem } from './ContextMenu';
import type { SearchItem } from '@shared';

interface SearchResultsProps {
  results: (SearchItem & { pluginId: string })[];
  selectedIndex: number;
  favorites: string[];
  query: string;
  onSelect: (item: SearchItem) => void;
  onHover: (index: number) => void;
  onContextMenu: (pluginId: string, items: MenuItem[]) => void;
}

export default function SearchResults(props: SearchResultsProps) {
  return (
    <div class="search-results">
      {props.results.length === 0 && (
        <div class="search-results-empty">
          {!props.query.trim() ? (
            <p class="text-sm text-text-muted">输入 <b style="color:var(--color-accent)">全部</b> 查看所有插件</p>
          ) : (
            <p class="text-sm text-text-muted">未找到匹配的插件</p>
          )}
        </div>
      )}

      <div class="search-results-grid">
        <For each={props.results}>
          {(item, index) => (
            <ResultItem
              item={item}
              isSelected={index() === props.selectedIndex}
              isFavorited={props.favorites.includes(item.pluginId)}
              onClick={() => props.onSelect(item)}
              onHover={() => props.onHover(index())}
              onContextMenu={(items) => props.onContextMenu(item.pluginId, items)}
            />
          )}
        </For>
      </div>
    </div>
  );
}

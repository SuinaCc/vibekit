export const SEARCH_MASTER_PLUGIN_ID = 'local.search-master';

export type SearchKind = 'all' | 'files' | 'folders';
export type SearchFileType = 'all' | 'image' | 'document' | 'video' | 'audio' | 'archive' | 'code';
export type SearchSizeFilter = 'any' | 'gt10mb' | 'gt100mb' | 'gt1gb';
export type SearchDateFilter = 'any' | 'today' | 'week' | 'month';
export type SearchSort =
  | 'name-ascending'
  | 'name-descending'
  | 'date-modified-descending'
  | 'size-descending';

export interface SearchQueryParams {
  query: string;
  kind: SearchKind;
  fileType: SearchFileType;
  size: SearchSizeFilter;
  date: SearchDateFilter;
  path: string | null;
  sort: SearchSort;
  offset: number;
  limit: number;
}

export interface SearchResultItem {
  name: string;
  fullPath: string;
  path: string;
  size: number;
  modified: string | null;
  created: string | null;
  extension: string;
  isFolder: boolean;
}

export interface SearchResponse {
  results: SearchResultItem[];
  total: number | null;
  offset: number;
  limit: number;
  elapsedMs: number;
}

export interface SearchMasterStatus {
  available: boolean;
  esVersion: string | null;
  everythingVersion: string | null;
  esPath: string | null;
  error?: string;
}

export type PreviewKind =
  | 'text'
  | 'image'
  | 'pdf'
  | 'video'
  | 'audio'
  | 'folder'
  | 'binary'
  | 'unsupported'
  | 'error';

export interface FilePreview {
  kind: PreviewKind;
  name: string;
  fullPath: string;
  extension: string;
  size: number;
  modified: string | null;
  created: string | null;
  accessed: string | null;
  isFolder: boolean;
  mime: string | null;
  text?: string;
  truncated?: boolean;
  dataUrl?: string;
  error?: string;
}

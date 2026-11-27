export const EVERY_COMPARE_PLUGIN_ID = 'local.every-compare';

export interface CompareTextFile {
  name: string;
  path: string;
  size: number;
  modified: string;
  text: string;
  truncated: boolean;
}

export interface CompareImageFile {
  name: string;
  path: string;
  size: number;
  modified: string;
  mime: string;
  dataUrl: string;
  width: number | null;
  height: number | null;
}

export type CompareFileKind = 'text' | 'image' | 'binary' | 'other';

export interface CompareFileInfo {
  name: string;
  path: string;
  size: number;
  modified: string;
  created: string;
  extension: string;
  kind: CompareFileKind;
  hash: string;
}

export interface CompareInspectResult {
  left: CompareFileInfo;
  right: CompareFileInfo;
  identical: boolean;
}

export type CompareDirMode = 'content' | 'quick';
export type CompareDirStatus = 'same' | 'different' | 'left-only' | 'right-only';

export interface CompareDirOptions {
  mode?: CompareDirMode;
  ignoreHidden?: boolean;
  ignoreNames?: string[];
  maxEntries?: number;
}

export interface CompareDirSide {
  name: string;
  path: string;
  size: number;
  modified: string;
  kind: CompareFileKind;
  hash?: string;
}

export interface CompareDirEntry {
  relPath: string;
  name: string;
  kind: 'file' | 'dir';
  status: CompareDirStatus;
  left: CompareDirSide | null;
  right: CompareDirSide | null;
}

export interface CompareDirStats {
  files: number;
  dirs: number;
  same: number;
  different: number;
  leftOnly: number;
  rightOnly: number;
  bytesLeft: number;
  bytesRight: number;
}

export interface CompareDirResult {
  leftRoot: string;
  rightRoot: string;
  mode: CompareDirMode;
  entries: CompareDirEntry[];
  stats: CompareDirStats;
  truncated: boolean;
  warnings: string[];
}

export interface LanConfig {
  enabled: boolean;
  deviceId: string;
  deviceName: string;
  discoveryPort: number;
  transferPort: number;
  downloadDir: string | null;
  trustedDevices: string[];
}

export interface LanDevice {
  id: string;
  name: string;
  address: string;
  port: number;
  lastSeen: number;
}

export interface LanPath {
  path: string;
  name: string;
  isDir: boolean;
  size?: number;
}

export type LanTransferState = 'offering' | 'transferring' | 'done' | 'cancelled' | 'error';

export interface LanProgress {
  transferId: string;
  deviceId: string;
  deviceName: string;
  direction: 'send' | 'receive';
  state: LanTransferState;
  bytes: number;
  total: number;
  filesDone: number;
  filesTotal: number;
  currentFile?: string;
  error?: string;
}

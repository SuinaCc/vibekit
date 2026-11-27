export const NETWORK_TOOLS_PLUGIN_ID = 'local.network-tools';

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS' | 'PTR';

export interface PingResult {
  host: string;
  resolvedIp: string | null;
  sent: number;
  received: number;
  lossPercent: number;
  minMs: number | null;
  avgMs: number | null;
  maxMs: number | null;
  jitterMs: number | null;
  rtts: number[];
  error?: string;
  timestamp: number;
}

export type TcpStatus = 'open' | 'closed' | 'timeout' | 'error';

export interface TcpCheckResult {
  host: string;
  port: number;
  status: TcpStatus;
  ok: boolean;
  connectMs: number | null;
  remoteAddress: string | null;
  error?: string;
  timestamp: number;
}

export interface DnsLookupResult {
  host: string;
  type: DnsRecordType;
  records: string[];
  durationMs: number;
  error?: string;
  timestamp: number;
}

export interface HttpCheckResult {
  url: string;
  finalUrl: string;
  method: 'HEAD' | 'GET';
  status: number;
  statusText: string;
  ok: boolean;
  durationMs: number;
  headers: Record<string, string>;
  error?: string;
  timestamp: number;
}

export interface NetInfo {
  ip: string;
  country: string | null;
  city: string | null;
  region: string | null;
  isp: string | null;
  colo: string | null;
  timestamp: number;
  error?: string;
}

export type NetSpeedPhase = 'ping' | 'download' | 'upload' | 'done';

export interface NetSpeedProgress {
  phase: NetSpeedPhase;
  elapsedMs: number;
  downloadMbps: number;
  uploadMbps: number;
  pingMs: number | null;
  jitterMs: number | null;
  bytesDown: number;
  bytesUp: number;
  message?: string;
}

export interface NetSpeedResult {
  downloadMbps: number;
  uploadMbps: number;
  pingMs: number | null;
  jitterMs: number | null;
  bytesDown: number;
  bytesUp: number;
  durationMs: number;
  server: string;
  colo: string | null;
  publicIp: string | null;
  city: string | null;
  isp: string | null;
  timestamp: number;
  cancelled?: boolean;
  error?: string;
}

export interface NetSpeedTestRequest {
  windowId: number;
}

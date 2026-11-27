import type { AeroRendererApi } from './types/api';

declare global {
  interface Window {
    aeroAPI: AeroRendererApi;
  }
}

export {};

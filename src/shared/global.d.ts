import type { VibeKitRendererApi } from './types/api';

declare global {
  interface Window {
    vibekitAPI: VibeKitRendererApi;
  }
}

export {};

export interface AiWebSite {
  id: string;
  name: string;
  url: string;
}

export interface AiWebBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AiWebConfig {
  sites: AiWebSite[];
  bounds: AiWebBounds | null;
  defaultSiteId: string | null;
}

export interface AiWebState {
  visible: boolean;
  siteId: string | null;
  defaultSiteId: string | null;
}

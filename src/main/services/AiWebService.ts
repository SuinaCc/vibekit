import { BrowserWindow, screen } from 'electron';
import type { AiWebBounds, AiWebSite, AiWebState } from '@shared';
import type { ConfigService } from './ConfigService';
import type { EventRouter } from './EventRouter';

export class AiWebService {
  private win: BrowserWindow | null = null;
  private currentSiteId: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private configService: ConfigService,
    private eventRouter: EventRouter,
  ) {}

  getSites(): AiWebSite[] {
    return this.configService.get().aiWeb.sites.map((site) => ({ ...site }));
  }

  setSites(sites: AiWebSite[]): AiWebSite[] {
    if (!Array.isArray(sites)) throw new Error('站点列表格式错误');
    const cleaned: AiWebSite[] = sites.slice(0, 20).map((site, index) => {
      const name = typeof site?.name === 'string' ? site.name.trim().slice(0, 80) : '';
      const rawUrl = typeof site?.url === 'string' ? site.url.trim() : '';
      if (!name || !rawUrl) throw new Error('站点名称和 URL 不能为空');
      const url = new URL(rawUrl);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error('只支持 http/https 站点');
      }
      const id = (typeof site.id === 'string' && site.id.trim())
        ? site.id.trim().replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 64)
        : `site-${index + 1}`;
      return { id, name, url: url.toString() };
    });
    if (new Set(cleaned.map((site) => site.id)).size !== cleaned.length) {
      throw new Error('站点 ID 不能重复');
    }
    this.configService.setValue('aiWeb.sites', cleaned);
    // Drop a default that points at a removed site.
    const defaultId = this.configService.get().aiWeb.defaultSiteId;
    if (defaultId && !cleaned.some((site) => site.id === defaultId)) {
      this.configService.setValue('aiWeb.defaultSiteId', null);
    }
    this.emitState();
    return cleaned;
  }

  getState(): AiWebState {
    const visible = !!this.win && !this.win.isDestroyed() && this.win.isVisible();
    return {
      visible,
      siteId: this.currentSiteId,
      defaultSiteId: this.configService.get().aiWeb.defaultSiteId,
    };
  }

  setDefaultSite(siteId: string | null): AiWebState {
    if (siteId !== null) {
      const exists = this.getSites().some((site) => site.id === siteId);
      if (!exists) throw new Error('站点不存在');
    }
    this.configService.setValue('aiWeb.defaultSiteId', siteId);
    this.emitState();
    return this.getState();
  }

  open(siteId?: string): void {
    const sites = this.getSites();
    if (sites.length === 0) throw new Error('请先配置 AI 网站');
    const defaultId = this.configService.get().aiWeb.defaultSiteId;
    const site = sites.find((item) => item.id === siteId)
      ?? sites.find((item) => item.id === defaultId)
      ?? sites.find((item) => item.id === this.currentSiteId)
      ?? sites[0];

    if (!this.win || this.win.isDestroyed()) {
      this.createWindow(site);
      return;
    }

    if (this.currentSiteId !== site.id) {
      this.currentSiteId = site.id;
      this.win.setTitle(site.name);
      void this.win.loadURL(site.url);
    }
    this.win.show();
    this.win.focus();
    this.emitState();
  }

  toggle(siteId?: string): void {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
      this.win.hide();
      this.emitState();
      return;
    }
    this.open(siteId);
  }

  destroy(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.currentSiteId = null;
  }

  private createWindow(site: AiWebSite): void {
    const bounds = this.getBounds();
    const win = new BrowserWindow({
      ...bounds,
      minWidth: 700,
      minHeight: 500,
      show: false,
      title: site.name,
      backgroundColor: '#111827',
      autoHideMenuBar: true,
      webPreferences: {
        partition: 'persist:vibekit-aiweb',
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });

    this.win = win;
    this.currentSiteId = site.id;

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            webPreferences: {
              partition: 'persist:vibekit-aiweb',
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
              webSecurity: true,
            },
          },
        };
      }
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => {
      if (!/^https?:/i.test(url)) event.preventDefault();
    });
    win.webContents.on('will-attach-webview', (event) => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });

    win.on('moved', () => this.scheduleSaveBounds(win));
    win.on('resized', () => this.scheduleSaveBounds(win));
    win.on('closed', () => {
      this.win = null;
      this.currentSiteId = null;
      this.emitState();
    });

    let shown = false;
    const show = () => {
      if (shown || win.isDestroyed()) return;
      shown = true;
      win.show();
      win.focus();
      this.emitState();
    };
    win.once('ready-to-show', show);
    setTimeout(show, 2000);

    void win.loadURL(site.url).catch((error) => {
      console.warn('AI web load failed:', error);
    });
  }

  private getBounds(): Partial<AiWebBounds> & { width: number; height: number } {
    const saved = this.configService.get().aiWeb.bounds;
    if (saved) {
      const display = screen.getDisplayMatching(saved);
      const area = display.workArea;
      const width = Math.min(Math.max(saved.width, 700), area.width);
      const height = Math.min(Math.max(saved.height, 500), area.height);
      const x = Math.min(Math.max(saved.x, area.x), area.x + area.width - width);
      const y = Math.min(Math.max(saved.y, area.y), area.y + area.height - height);
      return { x, y, width, height };
    }
    const area = screen.getPrimaryDisplay().workAreaSize;
    return {
      width: Math.min(1100, Math.max(700, area.width - 120)),
      height: Math.min(760, Math.max(500, area.height - 120)),
    };
  }

  private scheduleSaveBounds(win: BrowserWindow): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (!win.isDestroyed()) {
        this.configService.setValue('aiWeb.bounds', win.getBounds());
      }
    }, 300);
  }

  private emitState(): void {
    this.eventRouter.emit('vibekit:webState', this.getState());
  }
}

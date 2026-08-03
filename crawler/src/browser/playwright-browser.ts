import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export interface PlaywrightBrowserOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
  navigationTimeout?: number;
  actionTimeout?: number;
  locale?: string;
}

const DEFAULT_OPTIONS: Required<PlaywrightBrowserOptions> = {
  headless: true,
  viewport: { width: 1920, height: 1080 },
  navigationTimeout: 30_000,
  actionTimeout: 15_000,
  locale: 'vi-VN',
};

export class PlaywrightBrowser {
  private browser: Browser | null = null;

  constructor(private readonly options: PlaywrightBrowserOptions = {}) {}

  async start(): Promise<void> {
    if (this.browser) return;
    const opts = { ...DEFAULT_OPTIONS, ...this.options };
    this.browser = await chromium.launch({
      headless: opts.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
  }

  async createContext(): Promise<BrowserContext> {
    const browser = this.ensureStarted();
    const opts = { ...DEFAULT_OPTIONS, ...this.options };
    return browser.newContext({
      viewport: opts.viewport,
      locale: opts.locale,
      timezoneId: 'Asia/Ho_Chi_Minh',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
  }

  async createPage(context?: BrowserContext): Promise<Page> {
    const ctx = context ?? (await this.createContext());
    const page = await ctx.newPage();
    const opts = { ...DEFAULT_OPTIONS, ...this.options };
    page.setDefaultNavigationTimeout(opts.navigationTimeout);
    page.setDefaultTimeout(opts.actionTimeout);
    return page;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  isRunning(): boolean {
    return this.browser !== null;
  }

  private ensureStarted(): Browser {
    if (!this.browser) throw new Error('PlaywrightBrowser has not been started. Call start() first.');
    return this.browser;
  }
}

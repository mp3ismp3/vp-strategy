import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("home page subscription copy", () => {
  it("matches the current preview-first product flow", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/page.tsx"), "utf8");

    expect(source).not.toMatch(/免費試用|查看訂閱方案/);
    expect(source).toContain('href="/scanner"');
    expect(source).toContain("免費瀏覽 Scanner");
    expect(source).toContain("快速掌握市場方向，登入即可查看完整分析與交易信號");
    expect(source).toContain("Premium 方案提供 Telegram 即時信號私訊");
  });

  it("keeps the strategy cards free of decorative emoji icons", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/page.tsx"), "utf8");

    expect(source).not.toMatch(/[📊🔍📉⚡]/u);
  });

  it("uses a text-free animated trading chart in the right-side visual", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/page.tsx"), "utf8");
    const styles = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

    expect(source).toContain('aria-label="動態交易趨勢圖"');
    expect(source).toContain('data-testid="animated-trend-chart"');
    const chartStart = source.indexOf('data-testid="animated-trend-chart"');
    const chartEnd = source.indexOf("</svg>", chartStart);
    const chartVisual = source.slice(chartStart, chartEnd);
    expect(chartVisual).not.toMatch(
      /LIVE MARKET STRUCTURE|SMART MONEY ANALYTICS|資金流向視覺化|市場方向/,
    );
    expect(chartVisual).not.toContain("<text");
    expect(chartVisual).toContain('className="trend-chart-line"');
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain(".trend-chart-line");
    expect(source).toContain("lg:grid-cols-2");
  });
});

describe("trial-free product UI", () => {
  it("does not expose trial calls to action or countdowns", () => {
    const login = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");
    const account = readFileSync(resolve(process.cwd(), "src/app/account/page.tsx"), "utf8");
    const navbar = readFileSync(resolve(process.cwd(), "src/components/Navbar.tsx"), "utf8");

    expect(login).not.toContain("開始免費試用");
    const pricing = readFileSync(resolve(process.cwd(), "src/app/pricing/page.tsx"), "utf8");

    expect(login).toContain("查看方案");
    expect(account).not.toMatch(/trialDays|免費試用中/);
    expect(account).toContain('subscriptionStatus === "trialing" ? "active"');
    expect(navbar).not.toMatch(/trialDays|試用 \{/);
    expect([login, account, navbar, pricing].join("\n")).not.toContain("試用");
    expect(pricing).toContain("Free 免費使用；Pro NT$320／月；Premium NT$620／月。");
  });
});

describe("product branding", () => {
  it("uses the P Trade icon across the public brand surfaces", () => {
    const home = readFileSync(resolve(process.cwd(), "src/app/page.tsx"), "utf8");
    const login = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");
    const layout = readFileSync(resolve(process.cwd(), "src/app/layout.tsx"), "utf8");
    const navbar = readFileSync(resolve(process.cwd(), "src/components/Navbar.tsx"), "utf8");

    expect([home, login, navbar].join("\n")).not.toContain("💰");
    for (const source of [login, layout, navbar]) {
      expect(source).toContain("/ptrade.svg");
    }
    expect([home, login].join("\n")).not.toMatch(/\bpriority\b/);
    expect([home, login].join("\n").match(/\bpreload\b/g)).toHaveLength(1);
    expect(existsSync(resolve(process.cwd(), "src/app/favicon.ico"))).toBe(false);
    expect(existsSync(resolve(process.cwd(), "public/ptrade.svg"))).toBe(true);
  });
});

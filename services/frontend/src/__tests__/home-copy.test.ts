import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("home page subscription copy", () => {
  it("matches the current preview-first product flow", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/page.tsx"), "utf8");

    expect(source).not.toMatch(/免費試用|查看訂閱方案/);
    expect(source).toContain('href="/scanner"');
    expect(source).toContain("免費瀏覽 Scanner");
    expect(source).toContain("登入即可解鎖完整預覽");
    expect(source).toContain("Premium 方案提供 Telegram 即時信號私訊");
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

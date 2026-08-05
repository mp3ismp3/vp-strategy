# VP Strategy — 月訂閱制付費平台實作規劃

> 參考架構風格：[GoogleCloudPlatform/microservices-demo](https://github.com/googlecloudplatform/microservices-demo)
> 核心理念：服務分離、獨立部署、明確邊界、易於擴展

---

## 1. 決策摘要

| 項目 | 決定 |
|------|------|
| Auth Provider | Supabase（免費 PostgreSQL + 內建 Auth） |
| 登入方式 | Google OAuth + Email/Password（via NextAuth） |
| 付費方案 | Pro $29/月 + Premium $49/月 |
| 試用 | 7 天免費試用 Pro |
| 收款 | Stripe Subscriptions |
| 前端 | Next.js 14（App Router + TypeScript + Tailwind） |
| 圖表 | Lightweight Charts（TradingView 開源版） |
| UI 元件 | shadcn/ui |
| 通知 | Telegram Bot 私訊制（無群組） |
| 部署 | Frontend → Vercel（免費）/ Bot → VPS |

---

## 2. 系統架構圖

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER FACING                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Browser ──→ [frontend-service]  (Next.js + NextAuth + Stripe)     │
│                      │                                              │
│   Telegram ──→ [telegram-bot-service]  (私訊通知)                   │
│                      │                                              │
└──────────────────────┼──────────────────────────────────────────────┘
                       │
┌──────────────────────┼──────────────────────────────────────────────┐
│                  PLATFORM SERVICES                                   │
├──────────────────────┼──────────────────────────────────────────────┤
│                      ▼                                              │
│   [auth-service]          Supabase Auth (Google OAuth + Email)       │
│        │                                                            │
│        ▼                                                            │
│   [subscription-service]  Stripe Checkout + Webhook + 方案管理      │
│        │                                                            │
│        ▼                                                            │
│   [user-store]            Supabase PostgreSQL (users + subscriptions)│
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                       │
┌──────────────────────┼──────────────────────────────────────────────┐
│              EXISTING ANALYSIS ENGINE（不動）                        │
├──────────────────────┼──────────────────────────────────────────────┤
│                      ▼                                              │
│   [scanner-worker]        scan_all.py (VP Multi-TF)                 │
│   [accumulation-worker]   accumulation.py (Wyckoff Tracker)         │
│   [data-store]            data/*.json (scan_results, accum_state)   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 服務邊界定義（參考 microservices-demo 風格）

每個服務有獨立目錄、獨立 Dockerfile、獨立職責：

```
vp-strategy/
├── services/
│   ├── frontend/              # Next.js（React + TypeScript）
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── next.config.js
│   │   ├── tsconfig.json
│   │   ├── .env.local.example
│   │   ├── src/
│   │   │   ├── app/                    # App Router
│   │   │   │   ├── layout.tsx          # Root layout + providers
│   │   │   │   ├── page.tsx            # Landing page（未登入）/ Dashboard（已登入）
│   │   │   │   ├── login/page.tsx      # Login 頁面
│   │   │   │   ├── scanner/page.tsx    # VP Scanner（Pro+）
│   │   │   │   ├── accumulation/page.tsx  # Accumulation（Pro+）
│   │   │   │   ├── fusion/page.tsx     # Fusion（Premium）
│   │   │   │   ├── pricing/page.tsx    # 定價表 + CTA
│   │   │   │   ├── account/page.tsx    # 帳號設定 + Telegram 綁定
│   │   │   │   └── api/
│   │   │   │       ├── auth/[...nextauth]/route.ts  # NextAuth
│   │   │   │       ├── stripe/
│   │   │   │       │   ├── checkout/route.ts        # 建立 Checkout Session
│   │   │   │       │   └── webhook/route.ts         # Stripe Webhook
│   │   │   │       └── telegram/
│   │   │   │           └── bind/route.ts            # 綁定 token 產生
│   │   │   ├── components/
│   │   │   │   ├── Navbar.tsx
│   │   │   │   ├── PricingTable.tsx
│   │   │   │   ├── Paywall.tsx         # 付費牆元件
│   │   │   │   ├── charts/
│   │   │   │   │   ├── VPChart.tsx     # Volume Profile 圖表
│   │   │   │   │   ├── CandlestickChart.tsx
│   │   │   │   │   └── OBVChart.tsx
│   │   │   │   └── ui/                 # 共用 UI 元件（shadcn/ui）
│   │   │   ├── lib/
│   │   │   │   ├── supabase.ts         # Supabase client
│   │   │   │   ├── stripe.ts           # Stripe helpers
│   │   │   │   ├── auth.ts             # NextAuth config
│   │   │   │   └── plans.ts            # 方案定義 + 權限檢查
│   │   │   └── types/
│   │   │       ├── user.ts
│   │   │       └── signal.ts
│   │   └── public/
│   │       └── images/
│   │
│   ├── subscription/          # Stripe Webhook handler（備用，Next.js API route 也能處理）
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   ├── stripe_client.py
│   │   ├── webhook.py
│   │   └── plans.py
│   │
│   └── telegram-bot/          # Telegram 私訊通知
│       ├── Dockerfile
│       ├── requirements.txt
│       ├── bot.py            # Bot 主程式（/start 綁定）
│       └── notification_router.py  # 信號私訊分發
│
├── deploy/
│   ├── docker-compose.yml         # 本地開發 + 單機部署
│   ├── docker-compose.prod.yml    # 生產環境覆蓋
│   ├── .env.example               # 環境變數模板
│   └── nginx.conf                 # Reverse proxy（可選）
│
├── docs/
│   ├── SUBSCRIPTION_IMPLEMENTATION.md
│   ├── deployment.md
│   └── stripe-setup.md
│
├── ... (現有程式碼不動) ...
├── core/
├── strategies/
├── regime/
├── scoring/
├── scan_all.py
├── accumulation.py
└── config.py
```

---

## 4. 資料模型（Supabase PostgreSQL）

### users 表

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    auth_provider TEXT DEFAULT 'email',  -- 'email' | 'google'
    
    -- 訂閱狀態
    plan TEXT DEFAULT 'free',            -- 'free' | 'pro' | 'premium'
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT,
    subscription_status TEXT DEFAULT 'inactive',  -- 'active' | 'trialing' | 'past_due' | 'canceled' | 'inactive'
    trial_start TIMESTAMPTZ,
    trial_end TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    
    -- Telegram 綁定
    telegram_user_id BIGINT UNIQUE,
    telegram_username TEXT,
    
    -- 時間戳
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policy: 用戶只能讀自己的資料
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own data" ON users
    FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own data" ON users
    FOR UPDATE USING (auth.uid() = id);
```

### subscription_events 表（審計用）

```sql
CREATE TABLE subscription_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    event_type TEXT NOT NULL,         -- 'checkout_completed' | 'subscription_updated' | 'subscription_canceled' | 'trial_started'
    stripe_event_id TEXT UNIQUE,
    payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 5. 方案定義

```python
# services/subscription/plans.py

PLANS = {
    "free": {
        "name": "Free",
        "price_monthly": 0,
        "features": {
            "scanner_symbols": 5,        # 只看 5 檔
            "scanner_delay_days": 1,     # 延遲 1 天
            "accumulation": False,
            "fusion": False,
            "telegram_vip": False,
            "history_days": 0,
        },
    },
    "pro": {
        "name": "Pro",
        "price_monthly": 29,
        "stripe_price_id": "price_xxx_pro_monthly",  # 從 Stripe Dashboard 取得
        "features": {
            "scanner_symbols": -1,       # 全部 62 檔
            "scanner_delay_days": 0,     # 即時
            "accumulation": True,
            "fusion": False,
            "telegram_vip": True,
            "history_days": 7,
        },
    },
    "premium": {
        "name": "Premium",
        "price_monthly": 49,
        "stripe_price_id": "price_xxx_premium_monthly",
        "features": {
            "scanner_symbols": -1,
            "scanner_delay_days": 0,
            "accumulation": True,
            "fusion": True,
            "telegram_vip": True,
            "history_days": 30,
        },
    },
}

TRIAL_DAYS = 7  # Pro 試用天數
```

---

## 6. 核心流程

### 6.1 註冊 / 登入流程

```
用戶點擊 "Sign in with Google"
    │
    ▼
Supabase Auth → Google OAuth consent screen
    │
    ▼
Redirect back with session token
    │
    ▼
Frontend 檢查 users 表是否有記錄
    │
    ├── 有 → 載入 plan 狀態 → 進入 dashboard
    │
    └── 沒有 → 建立 users 記錄 (plan='free')
              → 顯示 "開始 7 天免費試用" CTA
```

### 6.2 訂閱付費流程

```
用戶點擊 "升級 Pro" / "升級 Premium"
    │
    ▼
Frontend 呼叫 subscription-service → 建立 Stripe Checkout Session
    │  (帶入 stripe_customer_id, price_id, trial_period_days=7)
    │
    ▼
Redirect → Stripe Checkout 頁面（Stripe hosted）
    │
    ▼
用戶填卡號 → 成功
    │
    ▼
Stripe 發 webhook → subscription-service/webhook.py
    │
    ├── event: checkout.session.completed
    │   → 更新 users 表: plan, stripe_customer_id, subscription_status='trialing'
    │   → 設定 trial_start, trial_end
    │
    ├── event: customer.subscription.updated
    │   → 更新 plan, current_period_end, subscription_status
    │
    ├── event: customer.subscription.deleted
    │   → plan='free', subscription_status='canceled'
    │   → 觸發 Telegram VIP 踢出
    │
    └── event: invoice.payment_failed
        → subscription_status='past_due'
        → 發通知提醒用戶更新卡號
```

### 6.3 付費牆檢查流程

```typescript
// services/frontend/src/lib/plans.ts

const PLAN_HIERARCHY = { free: 0, pro: 1, premium: 2 } as const;

export function hasAccess(userPlan: string, requiredPlan: string): boolean {
  return (PLAN_HIERARCHY[userPlan] ?? 0) >= (PLAN_HIERARCHY[requiredPlan] ?? 0);
}

// services/frontend/src/components/Paywall.tsx

export function Paywall({ requiredPlan, children }: { requiredPlan: string; children: React.ReactNode }) {
  const { data: session } = useSession();
  const user = useUser();

  if (!session) {
    return <LoginPrompt />;
  }

  if (!hasActiveSubscription(user)) {
    return <ExpiredNotice />;
  }

  if (!hasAccess(user.plan, requiredPlan)) {
    return <UpgradeCTA requiredPlan={requiredPlan} />;
  }

  return <>{children}</>;
}
```

### 6.4 Next.js Middleware（路由層保護）

```typescript
// services/frontend/src/middleware.ts

import { withAuth } from "next-auth/middleware";

export default withAuth({
  callbacks: {
    authorized: ({ token, req }) => {
      const path = req.nextUrl.pathname;
      
      // 公開頁面
      if (["/", "/login", "/pricing"].includes(path)) return true;
      
      // 需要登入的頁面
      if (!token) return false;
      
      // 需要 Pro+
      if (["/scanner", "/accumulation"].includes(path)) {
        return hasAccess(token.plan, "pro");
      }
      
      // 需要 Premium
      if (path === "/fusion") {
        return hasAccess(token.plan, "premium");
      }
      
      return true;
    },
  },
});

export const config = {
  matcher: ["/scanner", "/accumulation", "/fusion", "/account"],
};
```

---

## 7. Telegram 私訊制通知

### 核心原則

- **沒有公開群、沒有 VIP 群**
- Bot 直接私訊每位付費用戶
- 沒有有效訂閱 → Bot 完全不發任何消息
- 好處：內容不會被截圖轉發

### 架構

```
scan_all.py ─────┐
                 ├──→ notification_router.py
accumulation.py ─┘         │
                           ▼
                    查詢 Supabase: plan IN ('pro', 'premium')
                    AND telegram_user_id IS NOT NULL
                    AND subscription_status IN ('active', 'trialing')
                           │
                           ▼
                    逐一私訊每位付費用戶
                    (Bot → User DM)
```

### 通知內容分級

| 方案 | 收到什麼 |
|------|---------|
| Free | 完全不收到任何 Telegram 消息 |
| Pro | VP 掃描結果 + Accumulation 觸發信號 |
| Premium | Pro 全部 + Fusion 綜合分析 + 觸發即時提醒 |

### 私訊服務邏輯

```python
# services/telegram-bot/notification_router.py

class NotificationRouter:
    def broadcast_signal(self, signal: dict, min_plan: str = "pro"):
        """將信號私訊給所有符合資格的訂閱者"""
        subscribers = supabase.table("users").select("telegram_user_id, plan").in_(
            "subscription_status", ["active", "trialing"]
        ).not_.is_("telegram_user_id", "null").execute()
        
        for user in subscribers.data:
            if plan_level(user["plan"]) >= plan_level(min_plan):
                bot.send_message(
                    chat_id=user["telegram_user_id"],
                    text=format_signal(signal),
                    parse_mode="HTML",
                )
    
    def send_to_user(self, telegram_user_id: int, message: str):
        """私訊單一用戶（用於個人化通知）"""
        bot.send_message(chat_id=telegram_user_id, text=message, parse_mode="HTML")
```

### 用戶綁定流程

```
Web UI "連結 Telegram" 按鈕
    │
    ▼
顯示 Bot 連結 → 用戶在 Telegram 跟 Bot 說 /start {bind_token}
    │
    ▼
Bot 收到 → 驗證 bind_token → 更新 users 表 telegram_user_id
    │
    ▼
回覆用戶：「✅ 綁定成功！你將收到即時交易信號通知。」
    │
    ▼
若 plan='free' → 回覆：「目前為免費方案，升級後即可收到通知。」
```

### 退訂處理

```
Stripe webhook: subscription_canceled
    │
    ▼
更新 users 表 plan='free'
    │
    ▼
Bot 私訊該用戶：「你的訂閱已結束，通知已暫停。隨時可重新訂閱。」
    │
    ▼
之後不再發任何消息給該用戶
```

---

## 8. 部署架構

### 開發環境（docker-compose）

```yaml
# deploy/docker-compose.yml
version: "3.8"

services:
  frontend:
    build: ../services/frontend
    ports:
      - "3000:3000"
    env_file: .env
    volumes:
      - ../data:/app/data:ro  # 唯讀掛載分析結果 JSON

  telegram-bot:
    build: ../services/telegram-bot
    env_file: .env
    restart: unless-stopped

  # 現有分析引擎（保持不動，用 cron 或 GitHub Actions 觸發）
  # scanner 和 accumulation 不在 compose 裡，由 CI 驅動
```

### 生產部署選項

| 方案 | 適合階段 | 月費 | 特點 |
|------|---------|------|------|
| **Vercel（推薦）** | 0-1000 用戶 | 免費→$20 | Next.js 官方平台，零設定，自動 HTTPS + CDN |
| **單機 VPS + Docker** | 0-500 用戶 | ~$10-20 | 全掌控，適合搭配 telegram-bot |
| **Vercel + VPS** | 最佳組合 | ~$10-30 | Frontend 放 Vercel，Bot 放 VPS |
| **AWS ECS / GCP Cloud Run** | 500+ 用戶 | 按用量 | 自動擴展 |

**建議路徑：Frontend 部署到 Vercel（免費），telegram-bot 跑在現有 VPS。**

---

## 9. 環境變數

```bash
# deploy/.env.example

# ─── Supabase ───
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...   # Server-side only

# ─── Stripe ───
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO=price_xxx_pro_monthly
STRIPE_PRICE_PREMIUM=price_xxx_premium_monthly

# ─── Telegram ───
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
# 不再需要群組 ID，Bot 直接私訊用戶

# ─── App ───
APP_URL=https://your-domain.com
TRIAL_DAYS=7
```

---

## 10. 實作順序（Phase Plan）

```
Phase 1（MVP 上線）── 3 週
──────────────────────────────
Week 1:
  ✦ Next.js 專案初始化（App Router + Tailwind + shadcn/ui）
  ✦ Supabase 專案建立 + schema migration
  ✦ NextAuth 設定 Google OAuth + Supabase adapter
  ✦ Login / Logout 頁面

Week 2:
  ✦ Stripe 整合 — Checkout Session API route + Webhook
  ✦ 方案定義 + Middleware 路由保護
  ✦ Pricing 頁面 + 付費牆元件
  ✦ Account 頁面（管理訂閱 + Telegram 綁定）

Week 3:
  ✦ 圖表頁面（Scanner / Accumulation / Fusion）
  ✦ Landing page 設計
  ✦ 數據橋接（JSON → Supabase 或 API route 讀 file）
  ✦ 部署到 Vercel + 自訂域名

Phase 2（Telegram 私訊通知）── 1 週
──────────────────────────────
  ✦ Telegram Bot 設定 + /start 綁定流程
  ✦ notification_router 私訊分發邏輯
  ✦ 退訂自動停止通知
  ✦ 訂閱狀態變更時即時通知用戶

Phase 3（打磨 + 增長）── 持續
──────────────────────────────
  ✦ Customer Portal（Stripe 自助管理訂閱）
  ✦ 用量分析 Dashboard（幾個活躍用戶、轉換率）
  ✦ Referral 機制（推薦折扣）
  ✦ 年繳折扣方案
```

---

## 11. 擴展性設計

### 為什麼採用 services/ 分離結構

參考 microservices-demo 的做法，每個服務獨立目錄 + Dockerfile：

| 好處 | 說明 |
|------|------|
| **獨立部署** | 改 auth 不用重啟 frontend |
| **獨立擴展** | webhook 流量大時只擴 webhook |
| **技術自由** | 未來可以把 frontend 換成 Next.js，不影響其他 |
| **清晰邊界** | 新人看目錄就知道每個服務做什麼 |
| **漸進遷移** | 先 Docker Compose → 需要時直接搬上 K8s |

### 未來可加的服務

```
services/
├── analytics/        # 用戶行為追蹤（PV、功能使用率）
├── email/            # 歡迎信、試用到期提醒、付款失敗通知
├── api-gateway/      # 如果要開放 REST API 給程式化用戶
└── backtest/         # 付費用戶的自訂回測服務
```

### 服務間通訊

```
Browser ──(SSR/CSR)──→ Next.js Frontend (Vercel)
Next.js ──(server-side)──→ Supabase（讀 users / scan_results）
Next.js ──(API route)──→ Stripe Checkout（建立付款 session）
Stripe ──(webhook POST)──→ Next.js API route /api/stripe/webhook
Webhook handler ──(write)──→ Supabase（更新訂閱狀態）
telegram-bot ──(read)──→ Supabase（查詢付費用戶 + telegram_id）
scan_all.py ──(write)──→ Supabase scan_results 表（CI 完成後上傳）
```

---

## 12. 與現有系統的邊界

**嚴格規則：現有分析引擎不動。**

```
                    │ 邊界線
                    │
  新增（付費層）     │    現有（分析層）
 ─────────────────  │  ─────────────────
  services/frontend │    core/
  services/auth     │    strategies/
  services/sub      │    scan_all.py
  services/tg-bot   │    accumulation.py
                    │    data/*.json
                    │
  讀取 data/ JSON ←─┼──── 寫入 data/ JSON
  （唯讀消費者）     │    （唯一生產者）
```

付費層只做：
1. 驗證用戶身份
2. 檢查訂閱狀態
3. 決定顯示多少資料
4. 管理 Telegram VIP

絕不碰分析邏輯。

---

## 13. 待討論 / 確認事項

1. **定價確認** — Pro $29 / Premium $49 可以嗎？還是想先用更低的價格試水？

2. **免費方案的內容** — 目前設計 Free 可看 5 檔延遲 1 天，會不會太少/太多？目的是讓人嘗到甜頭但不夠用。

3. **年繳折扣** — 是否 Day 1 就提供？（建議先不要，等有穩定用戶再加）

4. **域名** — 有想好用什麼域名嗎？需要我幫你設定 DNS + SSL？

5. **Supabase 專案** — 已經建了還是需要我引導你建？

6. **Stripe 帳號** — 已註冊？需要引導設定 Products + Prices？

---

## 14. 技術棧 & 依賴

### Frontend（Next.js）

```json
// services/frontend/package.json 核心依賴
{
  "dependencies": {
    "next": "^14",
    "react": "^18",
    "next-auth": "^4",           // Google OAuth + session
    "@supabase/supabase-js": "^2", // DB 操作
    "stripe": "^15",             // Stripe Node SDK
    "@stripe/stripe-js": "^3",   // Stripe 前端
    "lightweight-charts": "^4",  // TradingView 開源圖表
    "tailwindcss": "^3",         // 樣式
    "shadcn/ui": "latest"        // UI 元件庫
  }
}
```

### Telegram Bot（Python，跑在 VPS）

```
# services/telegram-bot/requirements.txt
python-telegram-bot>=21.0
supabase>=2.0.0
```

### 數據橋接

Next.js 需要讀取分析結果 JSON，兩種方式：
1. **開發環境**：掛載 `data/` 目錄，直接讀 JSON file
2. **生產環境（Vercel）**：CI 掃描完後把 JSON 寫入 Supabase（新增一張 `scan_results` 表）

```python
# 在 scan_all.py 最後加一步（可選）
def upload_results_to_supabase(results: dict):
    """CI 掃描完後同步結果到 Supabase，讓 Vercel frontend 能讀取"""
    supabase.table("scan_results").upsert({
        "id": "latest",
        "data": results,
        "updated_at": datetime.utcnow().isoformat(),
    }).execute()
```

> 注意：現有 `requirements.txt`（根目錄）不動，它只服務分析引擎。

---

## Next Step

確認以上架構沒問題後，我會從 Phase 1 Week 1 開始實作：
1. `npx create-next-app` 初始化 `services/frontend/`
2. 設定 Tailwind + shadcn/ui
3. NextAuth + Google OAuth + Supabase adapter
4. Login / Pricing 頁面骨架

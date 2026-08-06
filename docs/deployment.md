# 部署指南

## 架構

```
Vercel (免費)          VPS (現有)           GitHub Actions
─────────────         ──────────           ──────────────
Next.js Frontend      Telegram Bot         scan_all.py
Stripe Webhook        (docker-compose)     accumulation.py
                                           export_frontend_data.py
                                           notification_router.py
```

---

## 1. Frontend 部署到 Vercel

### 步驟

1. 安裝 Vercel CLI：
   ```bash
   npm i -g vercel
   ```

2. 在 frontend 目錄部署：
   ```bash
   cd services/frontend
   vercel
   ```

3. 設定環境變數（Vercel Dashboard → Settings → Environment Variables）：
   ```
   NEXTAUTH_URL=https://your-domain.vercel.app
   NEXTAUTH_SECRET=<random-string>
   ADMIN_EMAILS=<comma-separated-admin-emails>
   GOOGLE_CLIENT_ID=<your-google-client-id>
   GOOGLE_CLIENT_SECRET=<your-google-client-secret>
   NEXT_PUBLIC_SUPABASE_URL=https://zviexeyaosdcuwpevywn.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
   SUPABASE_SERVICE_KEY=<your-service-key>
   STRIPE_SECRET_KEY=<your-stripe-secret-key>
   STRIPE_WEBHOOK_SECRET=<from-stripe-dashboard>
   STRIPE_PRICE_PRO=<server-side-price-id>
   STRIPE_PRICE_PREMIUM=<server-side-price-id>
   STRIPE_CHECKOUT_ENABLED=false
   NEXT_PUBLIC_APP_URL=https://your-domain.vercel.app
   ```

4. 設定自訂域名（可選）

5. Google OAuth 加入 redirect URI：
   ```
   https://your-domain.vercel.app/api/auth/callback/google
   ```

6. Stripe Dashboard → Webhooks → 新增 endpoint：
   ```
   https://your-domain.vercel.app/api/stripe/webhook
   ```
   Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.trial_will_end`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`

---

## 2. Telegram Bot 部署到 VPS

### 前置

1. 建立 Telegram Bot：跟 @BotFather 說 `/newbot`，拿到 token

2. 建立 `deploy/.env`：
   ```bash
   cp deploy/.env.example deploy/.env
   # 填入 TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY
   ```

### 啟動

```bash
cd deploy
docker-compose up -d
```

### 確認

```bash
docker-compose logs -f telegram-bot
```

---

## 3. GitHub Actions Secrets

到 GitHub → Settings → Secrets and variables → Actions，加入：

| Secret | 值 |
|--------|---|
| `TELEGRAM_BOT_TOKEN` | Bot token |
| `SUPABASE_URL` | https://zviexeyaosdcuwpevywn.supabase.co |
| `SUPABASE_SERVICE_KEY` | service role key |

CI 每天收盤後會：
1. 跑 `scan_all.py`（VP 掃描）
2. 跑 `accumulation.py`（累積追蹤）
3. 跑 `export_frontend_data.py`（產生前端圖表數據）
4. 跑 `notification_router.py`（私訊通知付費用戶）
5. Auto-commit `accum_state.json` + `frontend_charts.json`

---

## 4. 數據流（生產環境）

```
GitHub Actions (每天 21:05 UTC)
    │
    ├── scan_all.py → data/scan_results.json
    ├── accumulation.py → data/accum_state.json
    ├── export_frontend_data.py → data/frontend_charts.json
    ├── notification_router.py → Telegram DM 給付費用戶
    │
    └── git push → 觸發 Vercel 重新部署
                   → Frontend 讀到最新數據
```

注意：Vercel 從 git repo 讀取 `data/*.json`。CI push 後 Vercel 自動重新部署，前端就有最新數據。

---

## 5. 切換 Stripe Live Mode

準備上線收費時：

1. Stripe Dashboard → 關閉 Test mode
2. 重新建立 Products + Prices（live mode）
3. 更新 Vercel 環境變數：
   - `STRIPE_SECRET_KEY` → `sk_live_...`
   - `STRIPE_PRICE_PRO` → 新的 server-only price ID
   - `STRIPE_PRICE_PREMIUM` → 新的 server-only price ID
   - `STRIPE_CHECKOUT_ENABLED` → 驗收前維持 `false`
4. 重新設定 Webhook endpoint（live mode）
5. 測試一筆真實交易

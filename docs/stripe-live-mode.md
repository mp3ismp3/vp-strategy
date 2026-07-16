# Stripe Live Mode 切換指引

## 前置確認

- [ ] 測試模式下完整流程已驗證（註冊 → 付費 → 看資料 → 退訂）
- [ ] Stripe 帳號已完成身份驗證（Dashboard → Settings → Account details）
- [ ] 已準備好收款的銀行帳戶

## 步驟

### 1. 在 Stripe Live Mode 建立 Products

1. Stripe Dashboard → 左上角關閉 **Test mode**（切到 Live）
2. Products → + Add product：
   - `VP Strategy Pro` → $10/month recurring → 記下 Price ID（`price_live_...`）
   - `VP Strategy Premium` → $19/month recurring → 記下 Price ID（`price_live_...`）

### 2. 建立 Live Webhook

1. Developers → Webhooks → + Add endpoint
2. URL: `https://vp-strategy-nu.vercel.app/api/stripe/webhook`
3. Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
4. 記下 Signing secret（`whsec_live_...`）

### 3. 取得 Live API Key

1. Developers → API keys → 複製 Secret key（`sk_live_...`）

### 4. 更新 Vercel 環境變數

到 Vercel Dashboard → Settings → Environment Variables，更新：

```
STRIPE_SECRET_KEY = sk_live_...（取代 sk_test_）
STRIPE_WEBHOOK_SECRET = whsec_live_...（取代 whsec_test_）
NEXT_PUBLIC_STRIPE_PRICE_PRO = price_live_...（新的 Pro price ID）
NEXT_PUBLIC_STRIPE_PRICE_PREMIUM = price_live_...（新的 Premium price ID）
```

### 5. Redeploy

Vercel Dashboard → Deployments → Redeploy

### 6. 驗證

用一張真卡做一筆 $10 訂閱測試：
1. 註冊 + 付費
2. 確認 Supabase users 表 plan 更新
3. 確認能進 Pro 頁面
4. 退訂 → 確認 plan 回到 free
5. 如果測試沒問題，到 Stripe 退款那筆

## 注意事項

- Live mode 的 Product/Price ID 跟 Test mode **不同**，要重新建
- Webhook secret 也不同，要重新設
- 切換後 test mode 的測試資料不會影響 live mode
- 建議保留 test mode 的設定，方便日後開發測試

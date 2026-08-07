# Stripe 正式金流上線 Runbook

> Legacy only：台灣新訂閱已改用綠界，Production 必須保持 `STRIPE_CHECKOUT_ENABLED=false`。本文件只供既有 Stripe 訂閱、Portal、webhook 與 reconciliation 維運，不再執行新訂閱真卡驗收。

既有環境另須執行 `services/frontend/supabase_billing_providers.sql`，將 Stripe legacy records backfill 到通用 billing tables；migration 不會刪除舊欄位。

此文件只描述上線操作。不要把 Live secret 寫入 Git、聊天訊息或 Vercel Preview 環境。

## 0. 上線決策

- [ ] 確認 Pro / Premium 的幣別、月費與稅務顯示。
- [ ] 確認每位新用戶只有一次 7 天試用。
- [ ] 公開服務條款、隱私權、取消與退款政策。
- [ ] 確認取消於週期結束生效；Pro/Premium 不支援直接切換，必須取消並到期後重新訂閱。

## 1. 程式與資料庫前置

1. 在 Supabase SQL Editor 執行增量 migration：`services/frontend/supabase_billing_hardening.sql`。不要在既有專案重跑整套初始化檔。
2. 確認 `users` 有 `stripe_mode`、`trial_used_at`、`stripe_checkout_session_id`、`stripe_checkout_expires_at`。
3. 確認 `subscription_events` 有 `processing_status`、`processing_started_at`、`processed_at`、`last_error`。
4. 部署程式時先設定 `STRIPE_CHECKOUT_ENABLED=false`。

舊資料的 `stripe_mode` 會是 `NULL`。下一次 Checkout 會建立目前 mode 專用的新 Customer，不會拿 Test Customer ID 呼叫 Live API。

## 2. Stripe Live Dashboard

1. 完成 Stripe 帳號身分、商業資料與收款銀行驗證。
2. 在 Live Mode 建立 recurring Products / Prices：
   - `VP Strategy Pro`：USD 10 / month
   - `VP Strategy Premium`：USD 19 / month
3. 記錄兩個 Live Price ID。
4. 設定品牌、帳單顯示名稱、客服信箱、付款成功與失敗通知。
5. 建立專用 Live Customer Portal configuration：只允許更新付款方式、查看發票、週期末取消及到期前恢復訂閱；關閉產品與價格切換，並記錄 `bpc_...` configuration ID。
6. 設定 Smart Retries 與最終欠款狀態；`unpaid` / `canceled` 不應保留產品權限。

## 3. Live Webhook

Endpoint：

```text
https://vp-strategy-nu.vercel.app/api/stripe/webhook
```

只訂閱以下事件：

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.trial_will_end`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.payment_action_required`

建立後保存此 Live endpoint 專用的 Signing secret。Test endpoint 與 Live endpoint 的 `whsec_...` 不共用。

## 4. Vercel 環境隔離

Production 設定：

```text
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_PREMIUM=price_...
STRIPE_PORTAL_CONFIGURATION_ID=bpc_...
STRIPE_CHECKOUT_ENABLED=false
ADMIN_EMAILS=admin@example.com
NEXT_PUBLIC_APP_URL=https://vp-strategy-nu.vercel.app
```

Development / Preview 保持 Test key、Test Price 與 Test webhook。不要再使用舊的 `NEXT_PUBLIC_STRIPE_PRICE_*`。

## 5. 關閉 Checkout 的首次部署

1. Redeploy Production。
2. 確認首頁、登入、Pricing、Account 正常。
3. Pricing 點擊付費方案時必須顯示 Checkout 暫停訊息，不能建立 Session。
4. 從 Stripe Dashboard 對 Live webhook 發送測試事件，確認簽章成功、`subscription_events` 有 processed/failed 狀態。
5. 重送同一事件，確認不會重複處理。
6. 以 `ADMIN_EMAILS` 內的登入帳號呼叫 `POST /api/admin/stripe-reconcile`，body 使用 `{}`；確認 `dryRun=true` 且先人工檢查所有 differences/blocked。

## 6. 小額真卡驗收

1. 暫時設定 `STRIPE_CHECKOUT_ENABLED=true` 並 redeploy。
2. 使用內部新帳號購買 Pro。
3. 確認 Stripe Customer、Subscription、Invoice 與 Supabase user mapping。
4. 確認 `stripe_mode=live`、方案、狀態、trial/current period 時間正確。
5. 再對已有訂閱者呼叫 Checkout，必須回傳 `409`，不得建立 Portal Session 或第二筆 Subscription。
6. 從帳號頁進入 Portal，驗證可更新付款方式、週期末取消及恢復訂閱，且無法切換 Pro/Premium。
7. 用 Dashboard 重送 webhook，確認 ledger 去重。
8. 再次執行 reconciliation dry-run；只有結果無多重訂閱、未知 Price 或 mode mismatch 時，才可用 body `{"apply":true}` 修正 Supabase 差異。
9. 完成退款並記錄會計處理方式。

## 7. Go / No-Go

只有以下全部成立才保持 Checkout 開啟：

- [ ] Live webhook 最近事件全部 HTTP 2xx，沒有長期 `failed` ledger。
- [ ] 真卡付款後權限正確，取消後於預期時間降回 Free。
- [ ] 重複 Checkout、重複 webhook、付款失敗與 3DS 流程已驗證。
- [ ] Customer Portal、退款、客服與告警負責人已確認。
- [ ] Reconciliation dry-run 沒有 blocked，且 apply 後再次 dry-run 為零差異。

若任一項失敗，立刻設 `STRIPE_CHECKOUT_ENABLED=false` 並 redeploy。不要停用 webhook；既有訂閱仍需持續同步。修復後可在 Stripe Dashboard 重送失敗事件。

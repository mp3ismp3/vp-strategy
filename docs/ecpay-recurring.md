# 綠界信用卡定期定額上線 Runbook

## 行為契約

- Pro：NT$320／月；Premium：NT$620／月。
- 付款成功立即開通，不提供免費試用。
- 每月扣款一次，綠界訂單設定 `ExecTimes=99`。
- 不支援直接切換方案；先取消，待本期結束後重新訂閱。
- 取消停止後續授權，權限保留到 `current_period_end`。

## Database

既有 Production Supabase 執行 `services/frontend/supabase_billing_providers.sql`；不要重跑完整初始化 migration。Migration 會建立 provider-neutral billing tables、啟用 RLS 且不授權 anon/authenticated policy，並把既有 Stripe customer、subscription、event 資料冪等 backfill；只有 server-side service role 可存取，舊 Stripe 欄位暫時保留供 rollback。

若曾執行較早版本的同名 migration，必須安全重跑最新版；其中的 `DROP CONSTRAINT IF EXISTS billing_customers_user_id_provider_mode_key` 允許同一使用者在 Customer 被供應商刪除後建立替代 Customer，並補上 `last_provider_event_at` 與 `users.last_billing_event_at`，讓 subscription 及 entitlement snapshot 都只能被相同或較新的 callback 更新。重跑不會刪除 billing records。

最新版 migration 另建立 `billing_checkout_intents` 與跨 provider reservation RPC、`apply_ecpay_callback`、`refresh_user_entitlement`、Stripe sync/cancel、Telegram bind、retention RPC 與 `billing_cancel_outbox`。Checkout reservation 會鎖定 user row，確保 Stripe/ECPay 不能同時產生兩個付款頁；callback、subscription 與聚合 entitlement 在同一 transaction 完成；取消先保存 intent，retry worker 以 CAS claim 避免重複處理。Migration 明確撤除 billing、account 與 analysis tables 的 anon/authenticated grants。若 Production 已存在同一使用者的多筆未結束綠界訂閱，partial unique index 會拒絕建立；必須先人工核對綠界後台並終止重複訂單，不可自動刪除付款紀錄。新環境先執行 `supabase_migration.sql`，再執行最新版 `supabase_billing_providers.sql`。

## Environment

```text
ECPAY_MODE=test
ECPAY_MERCHANT_ID=綠界特店編號
ECPAY_HASH_KEY=綠界HashKey
ECPAY_HASH_IV=綠界HashIV
ECPAY_CHECKOUT_ENABLED=false
NEXT_PUBLIC_ECPAY_ENABLED=false
NEXT_PUBLIC_APP_URL=https://vp-strategy-nu.vercel.app
STRIPE_CHECKOUT_ENABLED=false
BILLING_RECONCILIATION_SECRET=至少32字元隨機值
BILLING_ALERT_WEBHOOK_URL=https://內部告警接收端
```

Preview 不得使用正式金鑰。Sandbox 驗收通過後才切換 `ECPAY_MODE=live`、換正式憑證並同時開啟兩個 ECPay flags，然後 redeploy。

GitHub repository Actions secrets 必須設定與 Vercel Production 相同的 `BILLING_RECONCILIATION_SECRET`、既有的 `TELEGRAM_BOT_TOKEN`，以及只指向私人 billing 管理群的 `BILLING_ALERT_TELEGRAM_CHAT_ID`；不可沿用交易掃描的 `TELEGRAM_CHAT_ID`。`.github/workflows/ecpay_reconcile.yml` 每日 02:30 UTC 呼叫 production reconcile API；HTTP/API schema 錯誤、`safeToEnableCheckout=false`、findings 或 unresolved events 都會讓 workflow 失敗並通知 billing Telegram。異常訊息最多列出各 10 筆 finding/event，以 3500 bytes 截斷，包含 issue 與 subscription/user/event ID 供 Supabase trace，不包含 email、secret 或完整 provider payload。Repository owner 仍應在 GitHub `Settings → Notifications → Actions` 啟用失敗 workflow email 作為備援。API 回應只在 runner 暫存，公開 log 與 job summary 僅記錄檢查數量。

## 回呼

```text
ReturnURL=https://vp-strategy-nu.vercel.app/api/ecpay/return
PeriodReturnURL=https://vp-strategy-nu.vercel.app/api/ecpay/period-return
OrderResultURL=https://vp-strategy-nu.vercel.app/api/ecpay/result
```

首次付款走 ReturnURL，第二期起走 PeriodReturnURL。OrderResultURL 只把瀏覽器導回 Account；所有方案狀態只依 server callback 的有效 CheckMacValue 更新。

## Sandbox 驗收

1. 套用 migration，以 Test credentials 部署並保持 flags 關閉，確認 Pricing 顯示暫不支援。
2. 同時開啟兩個 ECPay flags，redeploy。
3. 內部 Free 帳號訂閱 Pro，確認綠界 stage 顯示 NT$320、每月一次、99 次。
4. 用綠界官方測試卡付款，確認 `billing_subscriptions`、`billing_events`、`users` 更新為 active/pro。
5. 重送通知不得重複處理；`SimulatePaid=1` 不得開通。
6. 驗證 Premium NT$620，既有付費者不得建立另一方案。
7. Account 取消後確認後續授權停止、`cancel_at_period_end=true`，本期結束後回 Free。
8. 以 Free/Pro/Premium 直接呼叫 data APIs，確認 Free 僅 7 檔/前 10 名摘要、Pro 無法讀 Fusion、Premium 可讀 Fusion，anon Supabase SELECT 被拒絕。
9. 手動觸發 `ECPay Reconciliation Monitor` workflow，確認它以 `Authorization: Bearer $BILLING_RECONCILIATION_SECRET` 呼叫 `GET /api/admin/ecpay-reconcile`，provider query、金額、執行狀態、過期 active 與 unresolved events 全部正常；以測試異常驗證 Telegram trace 通知、workflow failure email 與告警接收端。
10. 模擬 provider Cancel 成功但本地 finalize 失敗，確認 outbox 保留且 `POST /api/admin/ecpay-cancel-retry` 可依 provider query 完成同步。
11. 驗證跨 provider：有效 ECPay Premium 不會被 Stripe deleted event 降級，有效 Stripe Premium 也不會被 ECPay past-due callback 降級。
12. 執行 `POST /api/admin/billing-retention`（預設 90 天），確認只清除逾期且 processed 的最小化 event，不刪除 processing/failed 稽核資料。

任何驗收失敗，立即將兩個 ECPay flags 設回 `false` 並 redeploy；保留 callback 路徑供既有訂閱持續同步。

綠界的 `PeriodReturnURL` 每期只通知一次，不保證在應用程式回傳 5xx 後重送。系統以官方 `QueryCreditCardPeriodInfo` 做 provider-side reconciliation，核對 MerchantID、MerchantTradeNo、PeriodAmount、ExecStatus 與授權次數；原始回應中的卡號片段與授權碼不寫入 event ledger。管理員仍須建立「查詢失敗／金額不符／provider 已終止但本地未結束」人工處理 SOP。功能 flags 必須維持關閉，直到 migration、排程告警、人工補帳與 sandbox/live E2E 全數完成。

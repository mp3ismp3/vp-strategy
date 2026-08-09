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

最新版 migration 另建立 `idx_billing_subscriptions_one_open_ecpay_per_user`，原子限制每位使用者只能有一筆 `pending`、`active`、`past_due` 或 `canceling` 的綠界訂閱。若 Production 已存在同一使用者的多筆未結束綠界訂閱，index 會拒絕建立；必須先人工核對綠界後台並終止重複訂單，不可自動刪除付款紀錄。

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
```

Preview 不得使用正式金鑰。Sandbox 驗收通過後才切換 `ECPAY_MODE=live`、換正式憑證並同時開啟兩個 ECPay flags，然後 redeploy。

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

任何驗收失敗，立即將兩個 ECPay flags 設回 `false` 並 redeploy；保留 callback 路徑供既有訂閱持續同步。

綠界的 `PeriodReturnURL` 每期只通知一次，不保證在應用程式回傳 5xx 後重送。目前尚未實作綠界定期定額查詢 API reconciliation；正式開放前必須建立定期對帳，否則漏收 callback 時可能產生狀態漂移。功能 flags 應維持關閉，直到此營運風險已有監控與補帳流程。

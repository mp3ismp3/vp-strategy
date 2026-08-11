from pathlib import Path
import unittest


ROOT = Path(__file__).parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "ecpay_reconcile.yml"


class EcpayReconcileWorkflowTest(unittest.TestCase):
    def test_daily_monitor_fails_closed_on_reconciliation_findings(self):
        source = WORKFLOW.read_text(encoding="utf-8")

        self.assertIn("schedule:", source)
        self.assertIn("workflow_dispatch:", source)
        self.assertIn("BILLING_RECONCILIATION_SECRET", source)
        self.assertIn("TELEGRAM_BOT_TOKEN", source)
        self.assertIn("BILLING_ALERT_TELEGRAM_CHAT_ID", source)
        self.assertNotIn("secrets.TELEGRAM_CHAT_ID", source)
        self.assertIn("/api/admin/ecpay-reconcile", source)
        self.assertIn("/sendMessage", source)
        self.assertIn("--data-urlencode", source)
        self.assertIn("[0:10][]", source)
        self.assertIn('detail=\\(.error // "n/a")', source)
        self.assertIn("head -c 3500", source)
        self.assertIn("--fail-with-body", source)
        self.assertIn("safeToEnableCheckout == true", source)
        self.assertIn("findings | length == 0", source)
        self.assertIn("unresolvedEvents | length == 0", source)
        self.assertIn("permissions:\n  contents: read", source)


if __name__ == "__main__":
    unittest.main()

# CLI ↔ billing-service realtime

```bash
export BILLING_URL=http://localhost:8081
export BILLING_API_KEY=<bearer>
export BILLING_ORG_ID=<org-uuid>

laststate billing status                 # live tier + usage + health
laststate billing checkout pilot         # hosted checkout URL (opens browser)
laststate billing portal                 # Stripe self-serve portal
laststate billing watch                  # SSE live tail (Ctrl+C to stop)
laststate billing watch --events invoice.paid,subscription.canceled
```

`--json` works on every command for scripts. The CLI never stores keys —
they come from env (or `.env` via `laststate config`).

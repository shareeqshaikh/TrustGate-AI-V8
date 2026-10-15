# 🛡️ TrustGate AI — Native UPI QR Checkout, UTR Verification & Deterministic Auto-Refund Gateway

TrustGate AI is an enterprise-grade, high-security SaaS platform providing native UPI QR checkout, subscription management, SHA-256 hashed API keys, deterministic AI auto-refunds with manual payout tracking, central Agent Manager, and automated email sentinel reminders.

---

## 🚀 Key Features

1. **Native UPI QR Checkout & Verification**:
   - **Subscriptions**:
     - **7 Days Plan**: ₹2 (200 paise, 7 days full gateway access).
     - **30 Days Plan**: ₹5 (500 paise, 30 days full gateway access).
   - Strict server-side integer paise math (₹1.00 = 100 paise; client never dictates price).
   - Real standards-compliant UPI QR codes generated locally with `qrcode`:
     ```
     upi://pay?pa=shareeqshaikh194@oksbi&pn=Shareeq%20Shaikh&am=<rupees>&cu=INR&tn=<ref>&tr=<ref>
     ```
   - **12-digit UTR submission**: User submits the 12-digit numeric reference number from Google Pay, PhonePe, Paytm, or BHIM.
   - **Duplicate UTR Prevention**: Rejects any UTR that has already been submitted or verified across any order or payout.
   - **Segregation of Duties**: Admin verifies incoming credits against bank records and confirms. Admins cannot verify or confirm their own orders (`ADMIN_CANNOT_CONFIRM_OWN_ORDER`).

2. **Deterministic AI Auto-Refund Rule Engine**:
   - 100% offline-ready deterministic rule engine (no Ollama installation or running daemon required).
   - Auto-approves refund claims if:
     - Requester owns the confirmed order.
     - Within policy window (`REFUND_WINDOW_DAYS` = 7 days).
     - Order is not already refunded.
     - User has an active subscription for the order.
     - Amount is within auto-refund threshold (`AUTO_REFUND_MAX_PAISE` = 500 paise / ₹5.00).
     - User provides a valid UPI ID (e.g. `user@oksbi` or `9876543210@upi`).
   - **Immediate Revocation**: Subscription is set to `CANCELLED` and API keys are immediately revoked upon approval.
   - Sets status to `APPROVED_PAYOUT_PENDING`.
   - Generates Payout UPI QR and deep link for the administrator to scan and disburse from their UPI app.

3. **Admin Manual Payout & Settlement Tracking**:
   - Admin scans the customer's Payout QR in GPay / PhonePe / Paytm to send funds directly to the customer's UPI ID.
   - Admin enters the 12-digit bank Payout UTR and clicks **"Mark Paid"**.
   - Validates UTR format and cross-record uniqueness, transitioning refund status to `PAID`.
   - Immutable audit block recorded in `audit_chain.json`.

4. **Secure SHA-256 Production API Keys**:
   - Cryptographically secure keys: `tg_live_<32 random bytes base64url>`.
   - Displayed **ONCE** upon first reveal; plaintext is permanently erased from server storage immediately after first read.
   - Protected endpoint `GET /api/v1/ping` with `Authorization: Bearer <key>`. Checks SHA-256 hash, non-revoked flag, and active subscription validity against the server clock.

5. **Central Agent Manager Integration**:
   - **Payment Agent**: Monitors orders in `AWAITING_VERIFICATION` and refunds in `APPROVED_PAYOUT_PENDING`. Preserves segregation of duties by never auto-confirming orders without manual administrator action.
   - **Email Agent**: Controls campaigns, provider health, AI draft generation, and automated 7-day renewal reminder sentinels.
   - **Emergency Stop**: Instantly halts agent task executions across the platform.

---

## 📡 API Endpoints

### Orders & Subscriptions
- `GET /api/v1/plans` — List primary subscription plans (7 Days ₹2, 30 Days ₹5)
- `POST /api/v1/orders` — Create order, returns `upiUri` and `qrDataUrl`
- `GET /api/v1/orders/:id` — Retrieve order and QR details
- `POST /api/v1/orders/:id/utr` — Customer submits 12-digit UTR
- `POST /api/v1/orders/:id/verify` — Alias for UTR submission

### Admin Order Verification (Requires Admin Role)
- `GET /api/v1/admin/orders` — List orders (supports `?status=AWAITING_VERIFICATION`)
- `POST /api/v1/admin/orders/:id/confirm` — Admin verifies UTR and activates subscription (enforces segregation of duties)
- `POST /api/v1/admin/orders/:id/reject` — Admin rejects order with reason

### Deterministic Auto-Refunds & Manual Payouts
- `GET /api/v1/refunds` — User sees own refunds; Admin sees all
- `POST /api/v1/refunds` — Customer requests refund with UPI ID (auto-approved if rules pass)
- `GET /api/v1/refunds/admin` — Admin queue for pending refunds
- `POST /api/v1/admin/refunds/:id/mark-paid` — Admin enters 12-digit payout UTR and marks `PAID`

### API Key & Gateway
- `GET /api/v1/account` — Account details, active subscription, orders, API key metadata
- `GET /api/v1/account/reveal-key/:id` — One-time plaintext API key reveal
- `POST /api/v1/account/revoke-key/:id` — Revoke active key
- `POST /api/v1/account/regenerate-key` — Regenerate new key
- `GET /api/v1/ping` — Authenticated test endpoint with `Bearer <key>`

---

## 🛠️ Configuration (`.env`)

```ini
PORT=4000
NODE_ENV=development
SESSION_SECRET=trustgate_secret_session_key
ADMIN_EMAIL=shareeqshaikh194@gmail.com
ADMIN_PASSWORD=adminPassword123

# UPI Merchant Settings
UPI_MERCHANT_ID=shareeqshaikh194@oksbi
UPI_MERCHANT_NAME=Shareeq Shaikh
PAYMENT_MODE=manual

# Refund Policy Settings
AUTO_REFUND_MAX_PAISE=500
REFUND_WINDOW_DAYS=7

# Email Sentinel Settings
EMAIL_PROVIDER=dryrun
EMAIL_DRY_RUN=true
EMAIL_FROM=noreply@trustgate.ai
EMAIL_FROM_NAME="TrustGate AI"
```

---

## 💻 Commands

```bash
# 1. Install dependencies
npm install && npm install --prefix server && npm install --prefix client

# 2. Run automated test suite (58 comprehensive unit & integration tests)
npm test --prefix server

# 3. Build for production
npm run build --prefix server
npm run build --prefix client

# 4. Start development servers
npm run dev
```

- **Frontend Application**: [http://localhost:5173](http://localhost:5173)
- **Backend API Gateway**: [http://localhost:4000](http://localhost:4000)
- **Health Check**: [http://localhost:4000/api/v1/health](http://localhost:4000/api/v1/health)

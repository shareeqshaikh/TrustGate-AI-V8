// Virtual (simulated) payments via the Auth App. No real UPI / real money.
const base = () => (process.env.AUTH_APP_URL || "").replace(/\/+$/, "");
const headers = () => ({
  "Content-Type": "application/json",
  "x-merchant-key": process.env.MERCHANT_API_KEY || "",
});

async function call(path: string, init?: RequestInit): Promise<any> {
  if (!base() || !process.env.MERCHANT_API_KEY) {
    throw Object.assign(new Error("Virtual payments not configured (set AUTH_APP_URL and MERCHANT_API_KEY)"), { status: 500 });
  }
  const res = await fetch(`${base()}${path}`, { ...init, headers: headers() });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.message || `Auth app error ${res.status}`), { status: res.status });
  return body;
}

export const VirtualPay = {
  createRequest: (amountPaise: number, label: string) =>
    call("/api/merchant/payment-requests", { method: "POST", body: JSON.stringify({ amountPaise, label }) }) as Promise<{
      id: string; qrText: string; qr: string; expiresAt: string; upiId: string;
    }>,
  getStatus: (id: string) =>
    call(`/api/merchant/payment-requests/${encodeURIComponent(id)}`) as Promise<{
      status: "pending" | "completed" | "expired" | "cancelled"; reference: string | null;
    }>,
  refund: (paymentRequestId: string, reason: string, upiId: string) =>
    call("/api/merchant/refund", { method: "POST", body: JSON.stringify({ paymentRequestId, reason, upiId }) }) as Promise<{
      reference: string; amountPaise: number;
    }>,
};

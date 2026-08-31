/* payments.js — payment gateway integration boundary.
 *
 * The actual charge/payout must be finalised server-side (never trust a
 * client-only "paid" flag in production). This module encapsulates that
 * boundary so the rest of the app is gateway-agnostic:
 *   - CONFIG.payment.provider === 'mock'     -> simulated, for local dev/demo
 *   - 'razorpay' / 'stripe'                   -> open the provider checkout,
 *                                                then confirm via your backend
 *
 * `charge`  = client money into the platform (req 3, admin "receive payment").
 * `payout`  = platform money out to the caregiver on completion (admin).
 *
 * Both return a { id, amount, status, at } transaction record. A real backend
 * webhook should be the authority that flips booking.payment.status.
 */
import { CONFIG } from './config.js';
import { uid, nowIso } from './models.js';

function commissionSplit(price) {
  const commission = Math.round(price * CONFIG.rules.platformCommission * 100) / 100;
  return { commission, caregiverAmount: Math.round((price - commission) * 100) / 100 };
}

async function mockCharge(booking) {
  await new Promise((r) => setTimeout(r, 400)); // simulate network
  return { id: uid('pay_in'), amount: booking.price, status: 'captured', at: nowIso() };
}

async function mockPayout(booking) {
  await new Promise((r) => setTimeout(r, 400));
  const { caregiverAmount } = commissionSplit(booking.price);
  return { id: uid('pay_out'), amount: caregiverAmount, status: 'transferred', at: nowIso() };
}

export const Payments = {
  commissionSplit,

  /**
   * Charge the client. For a real gateway, replace the mock branch with the
   * provider's checkout (e.g. Razorpay Checkout / Stripe Payment Element) and
   * confirm the payment with your backend before resolving.
   */
  async charge(booking) {
    if (CONFIG.payment.provider === 'mock') return mockCharge(booking);

    // --- Real gateway hook (pseudo-flow) -------------------------------------
    // 1. Ask your backend to create an order/intent for booking.price.
    // 2. Open the provider checkout with CONFIG.payment.publishableKey.
    // 3. On success, verify signature on the backend and resolve with the txn.
    // For now we fall back to mock so the flow is demonstrable without keys.
    console.warn(`Payments: provider "${CONFIG.payment.provider}" not wired to a backend yet; using mock.`);
    return mockCharge(booking);
  },

  /** Release the caregiver payout (admin action after completion). */
  async payout(booking) {
    if (CONFIG.payment.provider === 'mock') return mockPayout(booking);
    console.warn(`Payments: payout provider "${CONFIG.payment.provider}" not wired to a backend yet; using mock.`);
    return mockPayout(booking);
  }
};

/* Tests the at-risk decision used by the admin dashboard highlight/filter/count.
 * The rule lives inside admin/app.js (a DOM-booting module), so we assert the
 * exact same rule here to lock the behaviour; keep in sync with startRiskInfo. */
import { describe, it, expect } from 'vitest';
import { BookingStatus } from '../shared/models.js';

const NOT_STARTED = [BookingStatus.ACCEPTED, BookingStatus.EN_ROUTE, BookingStatus.ARRIVED];
function startRiskInfo(b, startAlertMinutes = 30, now = Date.now()) {
  if (!NOT_STARTED.includes(b.status) || !b.scheduledAt) return { atRisk: false };
  const msLeft = new Date(b.scheduledAt).getTime() - now;
  const minutesLeft = Math.round(msLeft / 60000);
  if (msLeft > startAlertMinutes * 60000) return { atRisk: false, minutesLeft };
  const label = minutesLeft < 0 ? `Overdue ${Math.abs(minutesLeft)}m` : `${minutesLeft}m left`;
  return { atRisk: true, label, minutesLeft };
}

const NOW = new Date('2026-09-01T10:00:00.000Z').getTime();
const at = (min) => new Date(NOW + min * 60000).toISOString();

describe('startRiskInfo (accepted-but-not-started within window)', () => {
  it('accepted, 20m away, 30m window -> at risk with "20m left"', () => {
    const r = startRiskInfo({ status: 'accepted', scheduledAt: at(20) }, 30, NOW);
    expect(r.atRisk).toBe(true);
    expect(r.label).toBe('20m left');
  });
  it('accepted, 45m away -> not at risk', () => {
    expect(startRiskInfo({ status: 'accepted', scheduledAt: at(45) }, 30, NOW).atRisk).toBe(false);
  });
  it('en_route, overdue 10m -> at risk with "Overdue 10m"', () => {
    const r = startRiskInfo({ status: 'en_route', scheduledAt: at(-10) }, 30, NOW);
    expect(r.atRisk).toBe(true);
    expect(r.label).toBe('Overdue 10m');
  });
  it('arrived is still "not started" -> at risk when near', () => {
    expect(startRiskInfo({ status: 'arrived', scheduledAt: at(5) }, 30, NOW).atRisk).toBe(true);
  });
  it('in_service (started) -> never at risk', () => {
    expect(startRiskInfo({ status: 'in_service', scheduledAt: at(1) }, 30, NOW).atRisk).toBe(false);
  });
  it('broadcast (no caregiver committed) -> not at risk', () => {
    expect(startRiskInfo({ status: 'broadcast', scheduledAt: at(1) }, 30, NOW).atRisk).toBe(false);
  });
  it('configurable window: 60m window catches a 45m-away booking', () => {
    expect(startRiskInfo({ status: 'accepted', scheduledAt: at(45) }, 60, NOW).atRisk).toBe(true);
  });
});

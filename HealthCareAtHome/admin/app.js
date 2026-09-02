/* Admin PWA controller — the middle-man dashboard (requirements 1, 2, 5, and
 * the admin payment/reporting duties).
 *
 * Admin sees EVERYTHING: confidential client PII, public caregiver profiles,
 * every booking with all secret codes, payment in/out, and daily / date-range
 * reports. Admin also provisions users with their login access codes.
 */
import {
  Speciality, BookingStatus, Availability, CaregiverStatus,
  createClient, createCaregiver, nowIso
} from '../shared/models.js';
import { COLLECTION } from '../shared/firebase.js';
import { Data, Sync } from '../shared/sync.js';
import { Lifecycle } from '../shared/lifecycle.js';
import { Payments } from '../shared/payments.js';
import { Notify } from '../shared/notify.js';
import { Settings } from '../shared/settings.js';
import { registerWithUpdates } from '../shared/pwa-update.js';
import { Services, createService, DEFAULT_COMMISSION_PCT, commissionFractionFor } from '../shared/services-master.js';
import { distanceKm, caregiverDistanceKm } from '../shared/geo.js';
import { geocode } from '../shared/maps.js';
import { guardedClick, guardOnce } from '../shared/dom.js';

const $ = (id) => document.getElementById(id);

const state = { clients: [], caregivers: [], bookings: [], services: [] };
const cgFilter = { name: '', spec: '', sex: '', km: null, point: null }; // point: {lat,lng}
const dashFilter = { includeCompleted: false, atRiskOnly: false };
// per-booking caregiver search (local overrides; never touches app-wide Settings)
const inviteState = { bookingId: null, radiusKm: null, mode: 'gps', name: '', sex: '', includeOffline: false, selected: new Set() };

/** True when the admin is mid-task: any modal open, or not on the dashboard
 *  tab. The periodic clock-refresh defers while this is true. */
function adminIsBusy() {
  const modalIds = ['editBookingModal', 'cancelReasonModal', 'inviteModal'];
  const modalOpen = modalIds.some((id) => {
    const el = document.getElementById(id);
    return el && !el.classList.contains('hidden');
  });
  const dash = document.getElementById('tab-dashboard');
  const dashVisible = dash && !dash.classList.contains('hidden');
  return modalOpen || !dashVisible;
}

function boot() {
  registerServiceWorker();
  Sync.start();
  Sync.onStatus(renderSyncDot);
  wireTabs();
  populateSpecPicker();
  wireSettings();
  wireServices();
  wireCaregiverFilters();
  wireDashboardFilters();
  wireInviteModal();
  wireCancelReasonModal();

  Sync.subscribe(COLLECTION.CLIENTS, (list) => { state.clients = list; renderClients(); renderDashboard(); });
  Sync.subscribe(COLLECTION.CAREGIVERS, (list) => { state.caregivers = list; renderCaregivers(); renderRegistrations(); renderDashboard(); });
  Sync.subscribe(COLLECTION.BOOKINGS, (list) => {
    state.bookings = list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    renderDashboard(); renderPayments();
  });

  // Keep the time-based at-risk highlight fresh as the clock advances — but
  // never re-render underneath ongoing admin activity (an open modal or when
  // the dashboard tab isn't visible). Real data changes still render via the
  // Sync subscriptions above; this timer only refreshes the clock-based view.
  setInterval(() => {
    if (!state.bookings.length) return;
    if (adminIsBusy()) return;
    renderDashboard();
  }, 60000);

  // default report window = today
  setToday();
}

function renderSyncDot(status) {
  const dot = $('syncDot');
  dot.className = 'status-dot ' + (!status.online ? 'red' : status.pending ? 'amber' : 'green');
  dot.title = !status.online ? 'offline' : status.pending ? `${status.pending} pending` : 'synced';
}

// ── tabs ────────────────────────────────────────────────────────────────────
function wireTabs() {
  document.querySelectorAll('.tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tabpane').forEach((p) => p.classList.add('hidden'));
      $('tab-' + btn.dataset.tab).classList.remove('hidden');
    });
  });
}

function populateSpecPicker() {
  $('cgSpecs').innerHTML = Object.values(Speciality)
    .map((s) => `<option value="${s}">${labelize(s)}</option>`).join('');
}

// ── location-verification settings ───────────────────────────────────────────
function wireSettings() {
  // reflect live settings into the controls
  Settings.subscribe((s) => {
    $('locVerifyToggle').checked = !!s.locationVerification;
    $('verifyRadius').value = s.verifyRadiusMeters;
    $('leadHours').value = s.bookingLeadHours ?? 4;
    $('priorityMode').value = s.priorityMode || 'multiplier';
    $('priorityValue').value = s.priorityValue ?? 1.5;
    if ($('matchLocationMode')) $('matchLocationMode').value = s.matchLocationMode || 'gps';
    if ($('startAlertMinutes')) $('startAlertMinutes').value = s.startAlertMinutes ?? 30;
    if ($('cancelReasons')) $('cancelReasons').value = (s.cancelReasons || []).join('\n');
  });

  $('saveSettingsBtn').addEventListener('click', async () => {
    const patch = {
      locationVerification: $('locVerifyToggle').checked,
      verifyRadiusMeters: Math.max(10, Number($('verifyRadius').value) || 50)
    };
    try {
      await Settings.update(patch);
      $('settingsStatus').textContent = `Saved · verification ${patch.locationVerification ? 'ON' : 'OFF'} · ${patch.verifyRadiusMeters} m`;
      Notify.toast('Settings saved', 'Location verification updated', 'success');
    } catch (e) {
      $('settingsStatus').textContent = 'Save failed: ' + e.message;
    }
  });

  $('savePriorityBtn').addEventListener('click', async () => {
    const patch = {
      bookingLeadHours: Math.max(0, Number($('leadHours').value) || 0),
      priorityMode: $('priorityMode').value,
      priorityValue: Math.max(0, Number($('priorityValue').value) || 0),
      matchLocationMode: ($('matchLocationMode') && $('matchLocationMode').value) || 'gps',
      startAlertMinutes: Math.max(1, Number($('startAlertMinutes').value) || 30)
    };
    try {
      await Settings.update(patch);
      $('priorityStatus').textContent = `Saved · lead ${patch.bookingLeadHours}h · priority ${patch.priorityMode} ${patch.priorityValue} · match ${patch.matchLocationMode} · start-risk ${patch.startAlertMinutes}m`;
      Notify.toast('Settings saved', 'Booking/priority updated', 'success');
    } catch (e) {
      $('priorityStatus').textContent = 'Save failed: ' + e.message;
    }
  });

  $('saveReasonsBtn').addEventListener('click', async () => {
    const reasons = $('cancelReasons').value
      .split('\n').map((l) => l.trim()).filter(Boolean);
    try {
      await Settings.update({ cancelReasons: reasons });
      $('reasonsStatus').textContent = `Saved · ${reasons.length} reason code(s)`;
      Notify.toast('Settings saved', 'Cancellation reasons updated', 'success');
    } catch (e) {
      $('reasonsStatus').textContent = 'Save failed: ' + e.message;
    }
  });
}

// ── services master ───────────────────────────────────────────────────────────
async function wireServices() {
  try { await Services.seedDefaults(); } catch (_) {/* offline; will seed later */}
  Services.subscribe((list) => {
    state.services = list.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    renderServices();
  });

  $('addServiceBtn').addEventListener('click', async () => {
    const name = $('svcName').value.trim();
    if (!name) return Notify.toast('Service', 'Name is required', 'error');
    const svc = createService({
      name,
      cost: Number($('svcCost').value) || 0,
      commissionPct: $('svcCommission').value === '' ? DEFAULT_COMMISSION_PCT : Number($('svcCommission').value)
    });
    await Services.save(svc);
    $('svcName').value = ''; $('svcCost').value = ''; $('svcCommission').value = '';
    Notify.toast('Service added', `${name} · ${svc.commissionPct}% commission`, 'success');
  });
}

function renderServices() {
  $('serviceRows').innerHTML = state.services.map((s) => `<tr>
    <td><input data-f="name" data-id="${s.id}" value="${escapeAttr(s.name)}" style="min-width:140px" /></td>
    <td class="codes">${s.key}</td>
    <td><input data-f="cost" data-id="${s.id}" type="number" min="0" value="${s.cost}" style="width:90px" /></td>
    <td><input data-f="commissionPct" data-id="${s.id}" type="number" min="0" max="100" value="${s.commissionPct}" style="width:80px" /></td>
    <td><input data-f="active" data-id="${s.id}" type="checkbox" ${s.active ? 'checked' : ''} /></td>
    <td>
      <button class="btn small" data-save="${s.id}">Save</button>
      <button class="btn danger small" data-del="${s.id}">Delete</button>
    </td>
  </tr>`).join('');

  $('serviceRows').querySelectorAll('[data-save]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.save;
      const svc = state.services.find((x) => x.id === id);
      if (!svc) return;
      const row = btn.closest('tr');
      const get = (f) => row.querySelector(`[data-f="${f}"][data-id="${id}"]`);
      svc.name = get('name').value.trim() || svc.name;
      svc.cost = Number(get('cost').value) || 0;
      svc.commissionPct = Number(get('commissionPct').value);
      svc.active = get('active').checked;
      await Services.save(svc);
      Notify.toast('Service saved', `${svc.name} · ${svc.commissionPct}%`, 'success');
    });
  });

  $('serviceRows').querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const svc = state.services.find((x) => x.id === btn.dataset.del);
      if (!svc) return;
      if (!confirm(`Delete service "${svc.name}"? Existing bookings keep their recorded values.`)) return;
      await Services.remove(svc.id);
      Notify.toast('Service deleted', svc.name, 'success');
    });
  });
}

function escapeAttr(s) {
  return String(s || '').replace(/"/g, '&quot;');
}

// ── dashboard (req 5: all bookings + all secret codes) ───────────────────────
function wireDashboardFilters() {
  const cb = $('includeCompleted');
  if (cb) {
    cb.checked = dashFilter.includeCompleted;
    cb.addEventListener('change', () => { dashFilter.includeCompleted = cb.checked; renderDashboard(); });
  }
  const risk = $('atRiskOnly');
  if (risk) {
    risk.checked = dashFilter.atRiskOnly;
    risk.addEventListener('change', () => { dashFilter.atRiskOnly = risk.checked; renderDashboard(); });
  }
}

// Statuses meaning "a caregiver has committed but service has not started yet".
const NOT_STARTED_STATUSES = [BookingStatus.ACCEPTED, BookingStatus.EN_ROUTE, BookingStatus.ARRIVED];

/**
 * Is this booking accepted-but-not-started with its scheduled time within the
 * admin's alert window (or already past)? Returns { atRisk, label, minutesLeft }.
 */
function startRiskInfo(b) {
  if (!NOT_STARTED_STATUSES.includes(b.status) || !b.scheduledAt) return { atRisk: false };
  const threshold = Number(Settings.current().startAlertMinutes ?? 30);
  const msLeft = new Date(b.scheduledAt).getTime() - Date.now();
  const minutesLeft = Math.round(msLeft / 60000);
  if (msLeft > threshold * 60000) return { atRisk: false, minutesLeft };
  const label = minutesLeft < 0
    ? `Overdue ${Math.abs(minutesLeft)}m`
    : `${minutesLeft}m left`;
  return { atRisk: true, label, minutesLeft };
}

function renderDashboard() {
  const active = state.bookings.filter((b) =>
    ![BookingStatus.COMPLETED, BookingStatus.CANCELLED, BookingStatus.EXPIRED].includes(b.status));
  const done = state.bookings.filter((b) => b.status === BookingStatus.COMPLETED);
  const revenue = done.reduce((s, b) => s + (b.price || 0), 0);

  $('mActive').textContent = active.length;
  $('mDone').textContent = done.length;
  $('mRevenue').textContent = revenue.toFixed(0);

  // count of at-risk bookings (accepted, not started, within/over the window)
  const atRiskTotal = state.bookings.filter((b) => startRiskInfo(b).atRisk).length;
  const riskBadge = $('atRiskCount');
  if (riskBadge) {
    riskBadge.textContent = `⏰ ${atRiskTotal} at risk`;
    riskBadge.classList.toggle('hidden', atRiskTotal === 0);
  }

  let rows = dashFilter.includeCompleted
    ? state.bookings
    : state.bookings.filter((b) => b.status !== BookingStatus.COMPLETED);
  if (dashFilter.atRiskOnly) rows = rows.filter((b) => startRiskInfo(b).atRisk);

  $('bookingRows').innerHTML = rows.map((b) => {
   try {
    const client = state.clients.find((c) => c.id === b.clientId);
    const cg = state.caregivers.find((c) => c.id === b.caregiverId);
    const recips = (b.recipients || []).map((r) => r.name).join(', ') || '—';
    const badges = [];
    if (b.priority) badges.push('<span class="badge broadcast">⚡ Priority</span>');
    if (b.clonedFrom) badges.push('<span class="badge accepted">↻ Rebooked</span>');
    const invitedN = (b.invitedCaregiverIds || []).length;
    if (invitedN) badges.push(`<span class="badge in_service">★ Invited ${invitedN}</span>`);

    // at-risk: accepted (committed) but service not started, and the scheduled
    // time is within the configured window (or already past) -> admin should act.
    const risk = startRiskInfo(b);
    if (risk.atRisk) {
      badges.push(`<span class="badge cancelled" title="Scheduled ${fmtDateTime(b.scheduledAt)} — not started">⏰ ${risk.label}</span>`);
    }

    const typeCell = badges.length ? badges.join(' ') : '<span class="badge">Normal</span>';
    // at-risk tints red (highest precedence); priority orange; clone blue
    const bg = risk.atRisk ? '#fde2e1' : (b.priority ? '#fff4e5' : (b.clonedFrom ? '#eef6ff' : ''));
    const rowStyle = bg ? ` style="background:${bg}"` : '';
    const canCancel = ![BookingStatus.COMPLETED, BookingStatus.CANCELLED].includes(b.status);
    return `<tr${rowStyle}>
      <td>${typeCell}</td>
      <td>${fmtDateTime(b.createdAt)}</td>
      <td>${b.scheduledAt ? fmtDateTime(b.scheduledAt) : '—'}</td>
      <td>${client ? client.name : b.clientId}</td>
      <td>${labelize(b.speciality)}${b.unitPrice ? ` (₹${b.unitPrice}×${(b.recipients||[]).length||1})` : ''}</td>
      <td style="font-size:12px">${recips}</td>
      <td>${cg ? cg.name : (b.caregiverName || '—')}</td>
      <td><span class="badge ${b.status}"${b.status === BookingStatus.CANCELLED && b.cancelReason ? ` title="${escapeAttr((b.cancelReasonCode && b.cancelReasonCode !== b.cancelReason ? b.cancelReasonCode + ': ' : '') + b.cancelReason + (b.cancelledBy ? ' (by ' + b.cancelledBy + ')' : ''))}"` : ''}>${labelize(b.status)}</span>${b.status === BookingStatus.CANCELLED && b.cancelReason ? `<br><span class="muted" style="font-size:11px">${b.cancelReason}</span>` : ''}</td>
      <td class="codes">${(b.codes && b.codes.startCode) || '—'}${b.codes && b.codes.startVerified ? ' ✓' : ''}</td>
      <td class="codes">${(b.codes && b.codes.completeCode) || '—'}${b.codes && b.codes.completeVerified ? ' ✓' : ''}</td>
      <td>${labelize((b.payment && b.payment.status) || 'unpaid')}</td>
      <td style="white-space:nowrap">
        <button class="btn small" data-edit-bk="${b.id}">Edit</button>
        ${b.status === BookingStatus.BROADCAST ? `<button class="btn small" data-invite-bk="${b.id}">Find caregivers</button>` : ''}
        ${canCancel ? `<button class="btn secondary small" data-cancel-bk="${b.id}">Cancel</button>` : ''}
        <button class="btn danger small" data-del-bk="${b.id}">Delete</button>
      </td>
    </tr>`;
   } catch (err) {
     // never let one malformed record blank the whole table
     console.warn('Skipping unrenderable booking', b && b.id, err);
     return `<tr style="background:#fde2e1"><td colspan="12" class="muted">Booking ${b && b.id ? b.id.slice(-6) : '?'} could not be displayed (${err.message}) — <button class="btn danger small" data-del-bk="${b && b.id}">Delete</button></td></tr>`;
   }
  }).join('');

  $('bookingRows').querySelectorAll('[data-del-bk]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const b = state.bookings.find((x) => x.id === btn.dataset.delBk);
      if (!b) return;
      if (!confirm(`Delete booking ${b.id.slice(-6)} (${labelize(b.speciality)})? This cannot be undone.`)) return;
      await Data.remove(COLLECTION.BOOKINGS, b.id);
      Notify.toast('Booking deleted', b.id.slice(-6), 'success');
    });
  });

  $('bookingRows').querySelectorAll('[data-edit-bk]').forEach((btn) => {
    btn.addEventListener('click', () => openEditBooking(btn.dataset.editBk));
  });

  $('bookingRows').querySelectorAll('[data-cancel-bk]').forEach((btn) => {
    btn.addEventListener('click', () => cancelBookingFlow(btn.dataset.cancelBk));
  });

  $('bookingRows').querySelectorAll('[data-invite-bk]').forEach((btn) => {
    btn.addEventListener('click', () => openInviteModal(btn.dataset.inviteBk));
  });
}

/** Fill a <select> with the configured reason codes plus an "Other" option. */
function populateReasonSelect(selectEl) {
  const reasons = Settings.current().cancelReasons || [];
  selectEl.innerHTML = reasons.map((r) => `<option value="${escapeAttr(r)}">${r}</option>`).join('')
    + '<option value="__other__">Other (free text)</option>';
}

let _cancelBookingId = null;

/**
 * Admin cancel flow: open the reason picker; on confirm, cancel the booking
 * (records a payment revision via Lifecycle.cancel), then ask whether to clone.
 */
function cancelBookingFlow(id) {
  const b = state.bookings.find((x) => x.id === id);
  if (!b) return;
  if ([BookingStatus.COMPLETED, BookingStatus.CANCELLED].includes(b.status)) {
    return Notify.toast('Cannot cancel', `Booking is already ${labelize(b.status)}.`, 'error');
  }
  _cancelBookingId = id;
  const paid = b.payment && b.payment.status === 'paid';
  $('crId').textContent = '#' + b.id.slice(-6);
  $('crInfo').textContent = `${labelize(b.speciality)} — `
    + (paid ? `₹${b.price} will be refunded (payment revision).` : 'A payment revision record will be created.');
  populateReasonSelect($('crReason'));
  $('crOtherWrap').classList.add('hidden');
  $('crOther').value = '';
  $('crClone').checked = false;
  $('cancelReasonModal').classList.remove('hidden');
}

function wireCancelReasonModal() {
  $('crReason').addEventListener('change', () => {
    $('crOtherWrap').classList.toggle('hidden', $('crReason').value !== '__other__');
  });
  $('crClose').addEventListener('click', () => {
    $('cancelReasonModal').classList.add('hidden');
    _cancelBookingId = null;
  });
  $('crConfirm').addEventListener('click', async () => {
    const b = state.bookings.find((x) => x.id === _cancelBookingId);
    if (!b) { $('cancelReasonModal').classList.add('hidden'); return; }
    const code = $('crReason').value;
    const isOther = code === '__other__';
    const reason = isOther ? $('crOther').value.trim() : code;
    if (isOther && !reason) return Notify.toast('Reason needed', 'Please specify the reason.', 'error');
    const doClone = $('crClone').checked;
    $('cancelReasonModal').classList.add('hidden');
    try {
      const { revision } = await Lifecycle.cancel(b, reason, { by: 'admin', reasonCode: isOther ? 'Other' : code });
      if (doClone) {
        // Rebook: carry the original paid status forward (already booked & paid).
        const fresh = Lifecycle.cloneBooking(b, { rebook: true });
        await Data.write(COLLECTION.BOOKINGS, fresh);
        // broadcast it so it's an open request, then open the link-caregiver
        // screen for the new booking so admin can dispatch immediately.
        try {
          const mode = Settings.current().matchLocationMode || 'gps';
          await Lifecycle.broadcast(fresh, state.caregivers, fresh.radiusKm, mode);
        } catch (_) { /* broadcast is best-effort; invite modal still works */ }
        Notify.toast('Rebooked', `New request ${fresh.id.slice(-6)} created from ${b.id.slice(-6)}.`, 'success');
        // ensure our local list has the up-to-date fresh booking before opening the modal
        const idx = state.bookings.findIndex((x) => x.id === fresh.id);
        if (idx >= 0) state.bookings[idx] = fresh; else state.bookings.unshift(fresh);
        openInviteModal(fresh.id);
      } else {
        Notify.toast('Booking cancelled',
          revision && revision.type === 'refund' ? `Refund of ₹${revision.amount} recorded.` : 'Payment revision recorded.',
          'success');
      }
    } catch (e) {
      Notify.toast('Cancel failed', e.message, 'error');
    } finally {
      _cancelBookingId = null;
    }
  });
}

// ── edit booking modal ────────────────────────────────────────────────────────
let _editingBookingId = null;

function openEditBooking(id) {
  const b = state.bookings.find((x) => x.id === id);
  if (!b) return;
  _editingBookingId = id;
  $('ebId').textContent = '#' + id.slice(-6);

  // service options from the master (fallback to enum)
  const svcOpts = state.services.length
    ? state.services.map((s) => `<option value="${s.key}">${s.name}</option>`).join('')
    : Object.values(Speciality).map((s) => `<option value="${s}">${labelize(s)}</option>`).join('');
  $('ebSpeciality').innerHTML = svcOpts;
  $('ebSpeciality').value = b.speciality;

  // status options
  $('ebStatus').innerHTML = Object.values(BookingStatus)
    .map((s) => `<option value="${s}">${labelize(s)}</option>`).join('');
  $('ebStatus').value = b.status;

  $('ebScheduledAt').value = b.scheduledAt ? toLocalInput(b.scheduledAt) : '';
  $('ebPrice').value = b.price || 0;
  $('ebRadius').value = b.radiusKm || CONFIG_defaultRadius();
  $('ebPriority').checked = !!b.priority;

  $('editBookingModal').classList.remove('hidden');
}

function CONFIG_defaultRadius() { return 15; }

function toLocalInput(iso) {
  try {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch (_) { return ''; }
}

$('ebCancel').addEventListener('click', () => {
  $('editBookingModal').classList.add('hidden');
  _editingBookingId = null;
});

guardedClick('ebSave', async () => {
  const b = state.bookings.find((x) => x.id === _editingBookingId);
  if (!b) return;
  const svc = state.services.find((s) => s.key === $('ebSpeciality').value);
  const updated = {
    ...b,
    speciality: $('ebSpeciality').value,
    serviceId: svc ? svc.id : b.serviceId,
    commissionPct: svc ? svc.commissionPct : b.commissionPct,
    scheduledAt: $('ebScheduledAt').value ? new Date($('ebScheduledAt').value).toISOString() : b.scheduledAt,
    price: Number($('ebPrice').value) || 0,
    radiusKm: Number($('ebRadius').value) || b.radiusKm,
    priority: $('ebPriority').checked,
    status: $('ebStatus').value,
    updatedAt: nowIso(),
    history: [...(b.history || []), { status: $('ebStatus').value, at: nowIso(), by: 'admin-edit' }]
  };
  try {
    await Data.write(COLLECTION.BOOKINGS, updated);
    $('editBookingModal').classList.add('hidden');
    _editingBookingId = null;
    Notify.toast('Booking updated', '#' + updated.id.slice(-6), 'success');
  } catch (e) {
    Notify.toast('Update failed', e.message, 'error');
  }
});

// ── clients (req 1: confidential, admin-only) ────────────────────────────────
$('addClientBtn').addEventListener('click', async () => {
  const name = $('clName').value.trim();
  const phone = $('clPhone').value.trim();
  if (!name || !phone) return Notify.toast('Client', 'Name and phone are required', 'error');

  const c = createClient({ name, phone, email: $('clEmail').value.trim() });
  c.accessCode = $('clCode').value.trim() || String(Math.floor(100000 + Math.random() * 900000));
  const label = $('clLocLabel').value.trim();
  const addr = $('clLocAddr').value.trim();
  if (label && addr) c.savedLocations = [{ label, address: addr, lat: null, lng: null }];

  await Data.write(COLLECTION.CLIENTS, c);
  ['clName', 'clPhone', 'clEmail', 'clCode', 'clLocLabel', 'clLocAddr'].forEach((id) => ($(id).value = ''));
  Notify.toast('Client added', `${name} · access code ${c.accessCode}`, 'success');
});

function renderClients() {
  $('clientRows').innerHTML = state.clients.map((c) => {
    const photo = c.photo
      ? `<img src="${c.photo}" alt="" style="width:40px;height:40px;border-radius:50%;object-fit:cover" />`
      : '';
    const details = [
      c.sex || null,
      c.dob ? `DOB ${c.dob}` : null,
      c.aadhaar ? `Aadhaar ${maskAadhaar(c.aadhaar.number)}${c.aadhaar.verified ? ' ✓' : ''}` : null,
      c.email || null
    ].filter(Boolean).join('<br>') || '—';
    const members = (c.members || []).length
      ? (c.members || []).map((m) => {
          const who = [m.forename, m.surname].filter(Boolean).join(' ');
          const rel = m.relationship ? ` (${m.relationship})` : '';
          const aad = m.aadhaar ? ` · ${maskAadhaar(m.aadhaar.number)}${m.aadhaar.verified ? ' ✓' : ''}` : '';
          return `${who}${rel}${aad}`;
        }).join('<br>')
      : '—';
    return `<tr>
    <td>${photo}</td>
    <td>${c.name}</td><td>${c.phone}</td>
    <td style="font-size:12px">${details}</td>
    <td class="codes">${c.accessCode || '—'}</td>
    <td style="font-size:12px">${(c.savedLocations || []).map((l) => `${l.label}: ${l.address}`).join('<br>') || '—'}</td>
    <td style="font-size:12px">${members}</td>
    <td><button class="btn danger small" data-del-client="${c.id}">Delete</button></td>
  </tr>`;
  }).join('');

  $('clientRows').querySelectorAll('[data-del-client]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const c = state.clients.find((x) => x.id === btn.dataset.delClient);
      if (!c) return;
      if (!confirm(`Delete client "${c.name}"? This cannot be undone.`)) return;
      await Data.remove(COLLECTION.CLIENTS, c.id);
      Notify.toast('Client deleted', c.name, 'success');
    });
  });
}

// ── caregivers (req 2: public profiles) ──────────────────────────────────────
$('addCgBtn').addEventListener('click', async () => {
  const name = $('cgName2').value.trim();
  const phone = $('cgPhone2').value.trim();
  if (!name || !phone) return Notify.toast('Caregiver', 'Name and phone are required', 'error');
  const specs = [...$('cgSpecs').selectedOptions].map((o) => o.value);
  if (!specs.length) return Notify.toast('Caregiver', 'Pick at least one speciality', 'error');

  const cg = createCaregiver({ name, phone, specialities: specs });
  cg.accessCode = $('cgCode2').value.trim() || String(Math.floor(100000 + Math.random() * 900000));
  cg.photo = _pendingCgPhoto; // resized data URL captured on file select (or null)
  await Data.write(COLLECTION.CAREGIVERS, cg);
  ['cgName2', 'cgPhone2', 'cgCode2'].forEach((id) => ($(id).value = ''));
  [...$('cgSpecs').options].forEach((o) => (o.selected = false));
  _pendingCgPhoto = null;
  $('cgPhoto2').value = '';
  $('cgPhotoPreview').style.display = 'none';
  Notify.toast('Caregiver added', `${name} · access code ${cg.accessCode}`, 'success');
});

// ── caregiver photo → resized data URL (avoids Firebase Storage dependency) ──
let _pendingCgPhoto = null;
$('cgPhoto2').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) { _pendingCgPhoto = null; $('cgPhotoPreview').style.display = 'none'; return; }
  try {
    _pendingCgPhoto = await resizeImageToDataUrl(file, 256, 0.8);
    $('cgPhotoPreview').src = _pendingCgPhoto;
    $('cgPhotoPreview').style.display = 'block';
  } catch (_) {
    Notify.toast('Photo', 'Could not read that image', 'error');
    _pendingCgPhoto = null;
  }
});

/** Downscale an image file to a square-ish thumbnail data URL (JPEG). */
function resizeImageToDataUrl(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderCaregivers() {
  // main table shows active/approved caregivers (registrations live on their own tab)
  let list = state.caregivers.filter((c) => (c.status || CaregiverStatus.ACTIVE) !== CaregiverStatus.REGISTERED);

  // apply filters
  const f = cgFilter;
  if (f.name) {
    const q = f.name.toLowerCase();
    list = list.filter((c) => (c.name || '').toLowerCase().includes(q));
  }
  if (f.spec) list = list.filter((c) => (c.specialities || []).includes(f.spec));
  if (f.sex) list = list.filter((c) => (c.sex || '') === f.sex);

  // annotate distance from the chosen point (if set), honoring the admin match mode
  const matchMode = Settings.current().matchLocationMode || 'gps';
  const withDist = list.map((c) => ({
    cg: c,
    dist: f.point ? caregiverDistanceKm(c, { location: f.point }, matchMode) : null
  }));
  let filtered = withDist;
  if (f.point && f.km) {
    filtered = withDist.filter((x) => isFinite(x.dist) && x.dist <= f.km);
  }
  // nearest first when a point is set
  if (f.point) filtered.sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity));

  $('fltCount').textContent = `${filtered.length} caregiver(s)`;

  $('cgRows').innerHTML = filtered.map(({ cg: c, dist }) => {
    const distTxt = f.point ? (isFinite(dist) ? `${dist.toFixed(1)} km` : 'n/a') : '—';
    return `<tr>
    <td>${c.name}</td>
    <td>${c.sex || '—'}</td>
    <td>${c.phone}</td>
    <td>${(c.specialities || []).map(labelize).join(', ')}</td>
    <td><span class="badge ${c.availability === Availability.AVAILABLE ? 'in_service' : c.availability === Availability.ON_SERVICE ? 'accepted' : 'cancelled'}">${labelize(c.availability)}</span></td>
    <td>${distTxt}</td>
    <td>★ ${c.rating || 'new'} (${c.ratingCount || 0})</td>
    <td class="codes">${c.accessCode || '—'}</td>
    <td><button class="btn danger small" data-del-cg="${c.id}">Delete</button></td>
  </tr>`;
  }).join('');

  $('cgRows').querySelectorAll('[data-del-cg]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const c = state.caregivers.find((x) => x.id === btn.dataset.delCg);
      if (!c) return;
      if (!confirm(`Delete caregiver "${c.name}"? This cannot be undone.`)) return;
      await Data.remove(COLLECTION.CAREGIVERS, c.id);
      Notify.toast('Caregiver deleted', c.name, 'success');
    });
  });
}

// ── caregiver directory filters ───────────────────────────────────────────────
function wireCaregiverFilters() {
  // populate the speciality filter from the enum
  $('fltSpec').innerHTML = '<option value="">Any speciality</option>' +
    Object.values(Speciality).map((s) => `<option value="${s}">${labelize(s)}</option>`).join('');

  $('fltName').addEventListener('input', () => { cgFilter.name = $('fltName').value.trim(); renderCaregivers(); });
  $('fltSpec').addEventListener('change', () => { cgFilter.spec = $('fltSpec').value; renderCaregivers(); });
  $('fltSex').addEventListener('change', () => { cgFilter.sex = $('fltSex').value; renderCaregivers(); });
  $('fltKm').addEventListener('input', () => { cgFilter.km = Number($('fltKm').value) || null; renderCaregivers(); });

  $('fltGeoBtn').addEventListener('click', async () => {
    const addr = $('fltGeoAddr').value.trim();
    if (!addr) return;
    $('fltGeoStatus').textContent = 'Locating…';
    try {
      const res = await geocode(addr);
      if (res) {
        cgFilter.point = { lat: res.lat, lng: res.lng };
        $('fltGeoStatus').textContent = `Point set: ${res.address}`;
      } else {
        cgFilter.point = null;
        $('fltGeoStatus').textContent = 'Could not locate that address.';
      }
    } catch (e) {
      cgFilter.point = null;
      $('fltGeoStatus').textContent = 'Map unavailable: ' + (e.message || 'could not locate');
    }
    renderCaregivers();
  });

  $('fltClear').addEventListener('click', () => {
    cgFilter.name = ''; cgFilter.spec = ''; cgFilter.sex = ''; cgFilter.km = null; cgFilter.point = null;
    $('fltName').value = ''; $('fltSpec').value = ''; $('fltSex').value = '';
    $('fltKm').value = ''; $('fltGeoAddr').value = ''; $('fltGeoStatus').textContent = '';
    renderCaregivers();
  });
}

// ── admin: find & invite caregivers for an open (broadcast) booking ──────────
function openInviteModal(id) {
  const b = state.bookings.find((x) => x.id === id);
  if (!b) return;
  // open (broadcast) requests, or a paid-but-not-yet-broadcast rebook, can be targeted
  if (![BookingStatus.BROADCAST, BookingStatus.PAID].includes(b.status)) {
    return Notify.toast('Not open', 'Only open (broadcast) or freshly paid bookings can be targeted.', 'error');
  }
  inviteState.bookingId = id;
  inviteState.radiusKm = b.radiusKm || 10;
  inviteState.mode = Settings.current().matchLocationMode || 'gps';
  inviteState.name = '';
  inviteState.sex = '';
  inviteState.selected = new Set(b.invitedCaregiverIds || []);

  $('ivId').textContent = '#' + b.id.slice(-6);
  $('ivBookingMeta').textContent =
    `${labelize(b.speciality)} · ${b.location.address || b.location.label || 'service location'} · scheduled ${b.scheduledAt ? fmtDateTime(b.scheduledAt) : '—'}`;
  inviteState.includeOffline = false;
  $('ivName').value = '';
  $('ivSex').value = '';
  $('ivRadius').value = inviteState.radiusKm;
  $('ivMode').value = inviteState.mode;
  $('ivIncludeOffline').checked = false;
  $('ivSelectAll').checked = false;
  $('ivStatus').textContent = '';
  renderInviteResults();
  $('inviteModal').classList.remove('hidden');
}

function closeInviteModal() {
  $('inviteModal').classList.add('hidden');
  inviteState.bookingId = null;
}

function renderInviteResults() {
  const b = state.bookings.find((x) => x.id === inviteState.bookingId);
  if (!b) return;
  const mode = inviteState.mode;
  const radius = inviteState.radiusKm || Infinity;

  // candidates: approved caregivers matching the booking speciality
  let list = state.caregivers.filter((c) =>
    (c.status || CaregiverStatus.ACTIVE) !== CaregiverStatus.REGISTERED &&
    Array.isArray(c.specialities) && c.specialities.includes(b.speciality));

  // by default show only currently-available caregivers; the checkbox widens
  // the pool to offline ones (matched by last-seen GPS, else service location)
  if (!inviteState.includeOffline) {
    list = list.filter((c) => c.availability === Availability.AVAILABLE);
  }

  if (inviteState.name) {
    const q = inviteState.name.toLowerCase();
    list = list.filter((c) => (c.name || '').toLowerCase().includes(q));
  }
  if (inviteState.sex) list = list.filter((c) => (c.sex || '') === inviteState.sex);

  // distance from the booking's service location, per the LOCAL match mode
  const withDist = list
    .map((c) => ({ cg: c, dist: caregiverDistanceKm(c, b, mode) }))
    .filter((x) => !isFinite(radius) ? true : (x.dist <= radius))
    .sort((a, b2) => (a.dist ?? Infinity) - (b2.dist ?? Infinity));

  $('ivCount').textContent =
    `${withDist.length} match(es) within ${isFinite(radius) ? radius + ' km' : 'any range'}`
    + (inviteState.includeOffline ? ' · incl. offline' : ' · available only');

  $('ivRows').innerHTML = withDist.map(({ cg: c, dist }) => {
    const checked = inviteState.selected.has(c.id) ? 'checked' : '';
    const distTxt = isFinite(dist) ? `${dist.toFixed(1)} km` : 'n/a';
    const offline = c.availability !== Availability.AVAILABLE;
    const availBadge = c.availability === Availability.AVAILABLE ? 'in_service'
      : c.availability === Availability.ON_SERVICE ? 'accepted' : 'cancelled';
    // for offline caregivers, note the last-seen time of their GPS point
    const lastSeen = offline && c.location && c.location.at
      ? `<br><span class="muted" style="font-size:11px">last seen ${fmtDateTime(c.location.at)}</span>`
      : (offline ? '<br><span class="muted" style="font-size:11px">service location</span>' : '');
    return `<tr>
      <td><input type="checkbox" data-iv-pick="${c.id}" ${checked} /></td>
      <td>${c.name}</td>
      <td>${c.sex || '—'}</td>
      <td style="font-size:12px">${(c.specialities || []).map(labelize).join(', ')}</td>
      <td><span class="badge ${availBadge}">${labelize(c.availability)}</span>${lastSeen}</td>
      <td>${distTxt}</td>
      <td>★ ${c.rating || 'new'}</td>
    </tr>`;
  }).join('');

  $('ivRows').querySelectorAll('[data-iv-pick]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const cid = cb.dataset.ivPick;
      if (cb.checked) inviteState.selected.add(cid); else inviteState.selected.delete(cid);
      syncSelectAllBox();
    });
  });
  syncSelectAllBox();
}

/** Reflect whether every currently-shown caregiver is selected. */
function syncSelectAllBox() {
  const boxes = [...document.querySelectorAll('#ivRows [data-iv-pick]')];
  const all = boxes.length > 0 && boxes.every((cb) => cb.checked);
  const el = $('ivSelectAll');
  if (el) el.checked = all;
}

function wireInviteModal() {
  $('ivName').addEventListener('input', () => { inviteState.name = $('ivName').value.trim(); renderInviteResults(); });
  $('ivSex').addEventListener('change', () => { inviteState.sex = $('ivSex').value; renderInviteResults(); });
  $('ivRadius').addEventListener('input', () => { inviteState.radiusKm = Number($('ivRadius').value) || null; renderInviteResults(); });
  $('ivMode').addEventListener('change', () => { inviteState.mode = $('ivMode').value; renderInviteResults(); });
  $('ivIncludeOffline').addEventListener('change', () => { inviteState.includeOffline = $('ivIncludeOffline').checked; renderInviteResults(); });
  $('ivSearch').addEventListener('click', renderInviteResults);
  $('ivClose').addEventListener('click', closeInviteModal);

  // single-click include/clear every caregiver currently shown
  $('ivSelectAll').addEventListener('change', () => {
    const on = $('ivSelectAll').checked;
    document.querySelectorAll('#ivRows [data-iv-pick]').forEach((cb) => {
      cb.checked = on;
      const cid = cb.dataset.ivPick;
      if (on) inviteState.selected.add(cid); else inviteState.selected.delete(cid);
    });
  });

  guardedClick('ivLink', async () => {
    const b = state.bookings.find((x) => x.id === inviteState.bookingId);
    if (!b) return;
    const ids = [...inviteState.selected];
    if (!ids.length) return Notify.toast('No selection', 'Pick at least one caregiver to link.', 'error');
    try {
      b.invitedCaregiverIds = ids;                 // high-precedence targeted invite
      b.updatedAt = nowIso();
      await Data.write(COLLECTION.BOOKINGS, b);      // stays in 'broadcast'; schemaless field
      const picked = state.caregivers.filter((c) => ids.includes(c.id));
      await Notify.toCaregivers(picked, {
        title: 'Priority invite',
        body: `Admin invited you to ${labelize(b.speciality)} near ${b.location.label || 'client'}`,
        bookingId: b.id
      });
      $('ivStatus').textContent = `Linked ${ids.length} caregiver(s) with high precedence.`;
      Notify.toast('Caregivers linked', `${ids.length} invited to booking ${b.id.slice(-6)}`, 'success');
      closeInviteModal();
    } catch (e) {
      $('ivStatus').textContent = 'Link failed: ' + e.message;
    }
  });
}

// ── caregiver registrations (approve / reject) ───────────────────────────────
function renderRegistrations() {
  const pending = state.caregivers.filter((c) => c.status === CaregiverStatus.REGISTERED);
  $('registrationEmpty').classList.toggle('hidden', pending.length > 0);

  $('registrationList').innerHTML = pending.map((c) => {
    const photo = c.photo
      ? `<img src="${c.photo}" alt="" style="width:64px;height:64px;border-radius:8px;object-fit:cover" />`
      : '<div style="width:64px;height:64px;border-radius:8px;background:#e5e7eb"></div>';
    const certs = (c.certificates || []).length
      ? (c.certificates || []).map((ct, i) =>
          `<a href="${ct.dataUrl}" target="_blank" rel="noopener" class="badge" style="margin:2px">📄 ${ct.name || ('Certificate ' + (i + 1))}</a>`).join(' ')
      : '<span class="muted">No certificates attached</span>';
    const addr = c.address ? `${c.address.address || '—'}${c.address.lat != null ? ` (${c.address.lat.toFixed(4)}, ${c.address.lng.toFixed(4)})` : ' — no map pin'}` : '—';
    const op = c.operatingLocation ? `${c.operatingLocation.address || '—'}${c.operatingLocation.lat != null ? ` (${c.operatingLocation.lat.toFixed(4)}, ${c.operatingLocation.lng.toFixed(4)})` : ' — no map pin'}` : '—';
    const aadhaar = c.aadhaar ? `${maskAadhaar(c.aadhaar.number)} ${c.aadhaar.verified ? '✓ verified' : '(unverified)'}` : '—';
    return `<div class="card" style="background:#f8fafc">
      <div style="display:flex;gap:12px">
        ${photo}
        <div style="flex:1">
          <strong>${c.name}</strong> <span class="muted">· DOB ${c.dob || '—'}</span>
          <div class="muted">${c.phone}</div>
          <div class="muted">${(c.specialities || []).map(labelize).join(', ')}</div>
        </div>
      </div>
      <div style="margin-top:8px;font-size:13px">
        <div><b>Aadhaar:</b> ${aadhaar}</div>
        <div><b>Address:</b> ${addr}</div>
        <div><b>Operating:</b> ${op}</div>
        <div style="margin-top:4px"><b>Certificates:</b> ${certs}</div>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn ok small" data-approve="${c.id}">Approve → Active</button>
        <button class="btn danger small" data-reject="${c.id}">Reject</button>
      </div>
    </div>`;
  }).join('');

  $('registrationList').querySelectorAll('[data-approve]').forEach((btn) => {
    guardOnce(btn, async () => {
      const c = state.caregivers.find((x) => x.id === btn.dataset.approve);
      if (!c || c.status === CaregiverStatus.ACTIVE) return;
      c.status = CaregiverStatus.ACTIVE;
      // issue a login access code if none set yet
      if (!c.accessCode) c.accessCode = String(Math.floor(100000 + Math.random() * 900000));
      c.updatedAt = nowIso();
      await Data.write(COLLECTION.CAREGIVERS, c);
      Notify.toast('Approved', `${c.name} is now active · access code ${c.accessCode}`, 'success');
    });
  });

  $('registrationList').querySelectorAll('[data-reject]').forEach((btn) => {
    guardOnce(btn, async () => {
      const c = state.caregivers.find((x) => x.id === btn.dataset.reject);
      if (!c || c.status === CaregiverStatus.REJECTED) return;
      if (!confirm(`Reject ${c.name}'s registration?`)) return;
      c.status = CaregiverStatus.REJECTED;
      c.updatedAt = nowIso();
      await Data.write(COLLECTION.CAREGIVERS, c);
      Notify.toast('Rejected', c.name, 'info');
    });
  });
}

function maskAadhaar(num) {
  const s = String(num || '').replace(/\s/g, '');
  return s.length === 12 ? `XXXX XXXX ${s.slice(-4)}` : (s || '—');
}

// ── payments (admin receives + releases payout) ──────────────────────────────
function renderPayments() {
  const rows = state.bookings
    .filter((b) => b.payment.status !== 'unpaid')
    .map((b) => {
      const { caregiverAmount } = Payments.commissionSplit(b.price || 0, commissionFractionFor(b, state.services));
      const canRelease = b.status === BookingStatus.COMPLETED && b.payment.status === 'paid';
      const released = b.payment.status === 'released';
      const btn = released
        ? '<span class="badge completed">Released</span>'
        : canRelease
          ? `<button class="btn ok small" data-payout="${b.id}">Release payout</button>`
          : '<span class="muted">after completion</span>';
      return `<tr>
        <td>${b.id.slice(-6)}</td>
        <td>₹${b.price} (${labelize(b.payment.status)})</td>
        <td>${b.payment.inTxnId ? b.payment.inTxnId.slice(-8) : '—'}</td>
        <td>₹${caregiverAmount}</td>
        <td>${b.payment.outTxnId ? b.payment.outTxnId.slice(-8) : '—'}</td>
        <td>${btn}</td>
      </tr>`;
    }).join('');
  $('payRows').innerHTML = rows;

  $('payRows').querySelectorAll('[data-payout]').forEach((btn) => {
    guardOnce(btn, async () => {
      const b = await Data.get(COLLECTION.BOOKINGS, btn.dataset.payout);
      if (!b) return;
      if (b.payment && b.payment.status === 'released') {
        return Notify.toast('Already released', `Payout for ${b.id.slice(-6)} was already released.`, 'info');
      }
      try {
        await Lifecycle.releasePayout(b);
        Notify.toast('Payout released', `Caregiver paid for booking ${b.id.slice(-6)}`, 'success');
      } catch (e) {
        Notify.toast('Payout failed', e.message, 'error');
      }
    });
  });
}

// ── reports (daily + date range) ─────────────────────────────────────────────
$('repTodayBtn').addEventListener('click', () => { setToday(); runReport(); });
$('repRunBtn').addEventListener('click', runReport);

function setToday() {
  const t = new Date().toISOString().slice(0, 10);
  $('repFrom').value = t; $('repTo').value = t;
}

function runReport() {
  const from = $('repFrom').value;
  const to = $('repTo').value;
  if (!from || !to) return Notify.toast('Reports', 'Choose a date range', 'error');
  const start = from + 'T00:00:00.000Z';
  const end = to + 'T23:59:59.999Z';

  const inRange = state.bookings.filter((b) => b.createdAt >= start && b.createdAt <= end);
  const done = inRange.filter((b) => b.status === BookingStatus.COMPLETED);
  const gross = done.reduce((s, b) => s + (b.price || 0), 0);
  let commission = 0, payout = 0, ratingSum = 0, ratingN = 0;
  done.forEach((b) => {
    const split = Payments.commissionSplit(b.price || 0, commissionFractionFor(b, state.services));
    commission += split.commission; payout += split.caregiverAmount;
    if (b.feedback && b.feedback.stars) { ratingSum += b.feedback.stars; ratingN++; }
  });

  $('rCount').textContent = inRange.length;
  $('rDone').textContent = done.length;
  $('rGross').textContent = gross.toFixed(0);
  $('rCommission').textContent = commission.toFixed(0);
  $('rPayout').textContent = payout.toFixed(0);
  $('rRating').textContent = ratingN ? (ratingSum / ratingN).toFixed(1) : '—';

  $('repRows').innerHTML = inRange.map((b) => {
    const cg = state.caregivers.find((c) => c.id === b.caregiverId);
    return `<tr>
      <td>${fmtDateTime(b.createdAt)}</td>
      <td>${labelize(b.speciality)}</td>
      <td>${cg ? cg.name : (b.caregiverName || '—')}</td>
      <td><span class="badge ${b.status}">${labelize(b.status)}</span></td>
      <td>₹${b.price}</td>
      <td>${b.feedback && b.feedback.stars ? '★ ' + b.feedback.stars : '—'}</td>
    </tr>`;
  }).join('');
}

// ── helpers ───────────────────────────────────────────────────────────────────
function labelize(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
function fmtDateTime(iso) {
  try { return new Date(iso).toLocaleString(); } catch (_) { return iso; }
}
function registerServiceWorker() {
  registerWithUpdates('./sw.js');
}

boot();

/* Admin PWA controller — the middle-man dashboard (requirements 1, 2, 5, and
 * the admin payment/reporting duties).
 *
 * Admin sees EVERYTHING: confidential client PII, public caregiver profiles,
 * every booking with all secret codes, payment in/out, and daily / date-range
 * reports. Admin also provisions users with their login access codes.
 */
import {
  Speciality, BookingStatus, Availability,
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

const $ = (id) => document.getElementById(id);

const state = { clients: [], caregivers: [], bookings: [], services: [] };

function boot() {
  registerServiceWorker();
  Sync.start();
  Sync.onStatus(renderSyncDot);
  wireTabs();
  populateSpecPicker();
  wireSettings();
  wireServices();

  Sync.subscribe(COLLECTION.CLIENTS, (list) => { state.clients = list; renderClients(); renderDashboard(); });
  Sync.subscribe(COLLECTION.CAREGIVERS, (list) => { state.caregivers = list; renderCaregivers(); renderDashboard(); });
  Sync.subscribe(COLLECTION.BOOKINGS, (list) => {
    state.bookings = list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    renderDashboard(); renderPayments();
  });

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
function renderDashboard() {
  const active = state.bookings.filter((b) =>
    ![BookingStatus.COMPLETED, BookingStatus.CANCELLED, BookingStatus.EXPIRED].includes(b.status));
  const done = state.bookings.filter((b) => b.status === BookingStatus.COMPLETED);
  const revenue = done.reduce((s, b) => s + (b.price || 0), 0);

  $('mActive').textContent = active.length;
  $('mDone').textContent = done.length;
  $('mRevenue').textContent = revenue.toFixed(0);

  $('bookingRows').innerHTML = state.bookings.map((b) => {
    const client = state.clients.find((c) => c.id === b.clientId);
    const cg = state.caregivers.find((c) => c.id === b.caregiverId);
    return `<tr>
      <td>${fmtDateTime(b.createdAt)}</td>
      <td>${client ? client.name : b.clientId}</td>
      <td>${labelize(b.speciality)}</td>
      <td>${cg ? cg.name : (b.caregiverName || '—')}</td>
      <td><span class="badge ${b.status}">${labelize(b.status)}</span></td>
      <td class="codes">${b.codes.startCode || '—'}${b.codes.startVerified ? ' ✓' : ''}</td>
      <td class="codes">${b.codes.completeCode || '—'}${b.codes.completeVerified ? ' ✓' : ''}</td>
      <td>${labelize(b.payment.status)}</td>
    </tr>`;
  }).join('');
}

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
  $('clientRows').innerHTML = state.clients.map((c) => `<tr>
    <td>${c.name}</td><td>${c.phone}</td><td>${c.email || '—'}</td>
    <td class="codes">${c.accessCode || '—'}</td>
    <td>${(c.savedLocations || []).map((l) => `${l.label}: ${l.address}`).join('<br>') || '—'}</td>
    <td><button class="btn danger small" data-del-client="${c.id}">Delete</button></td>
  </tr>`).join('');

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
  $('cgRows').innerHTML = state.caregivers.map((c) => `<tr>
    <td>${c.name}</td><td>${c.phone}</td>
    <td>${(c.specialities || []).map(labelize).join(', ')}</td>
    <td><span class="badge ${c.availability === Availability.AVAILABLE ? 'in_service' : c.availability === Availability.ON_SERVICE ? 'accepted' : 'cancelled'}">${labelize(c.availability)}</span></td>
    <td>★ ${c.rating || 'new'} (${c.ratingCount || 0})</td>
    <td class="codes">${c.accessCode || '—'}</td>
    <td><button class="btn danger small" data-del-cg="${c.id}">Delete</button></td>
  </tr>`).join('');

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
    btn.addEventListener('click', async () => {
      const b = await Data.get(COLLECTION.BOOKINGS, btn.dataset.payout);
      await Lifecycle.releasePayout(b);
      Notify.toast('Payout released', `Caregiver paid for booking ${b.id.slice(-6)}`, 'success');
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

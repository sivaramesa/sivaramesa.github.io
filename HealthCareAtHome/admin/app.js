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
import { distanceKm } from '../shared/geo.js';
import { geocode } from '../shared/maps.js';

const $ = (id) => document.getElementById(id);

const state = { clients: [], caregivers: [], bookings: [], services: [] };
const cgFilter = { name: '', spec: '', sex: '', km: null, point: null }; // point: {lat,lng}

function boot() {
  registerServiceWorker();
  Sync.start();
  Sync.onStatus(renderSyncDot);
  wireTabs();
  populateSpecPicker();
  wireSettings();
  wireServices();
  wireCaregiverFilters();

  Sync.subscribe(COLLECTION.CLIENTS, (list) => { state.clients = list; renderClients(); renderDashboard(); });
  Sync.subscribe(COLLECTION.CAREGIVERS, (list) => { state.caregivers = list; renderCaregivers(); renderRegistrations(); renderDashboard(); });
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
    $('leadHours').value = s.bookingLeadHours ?? 4;
    $('priorityMode').value = s.priorityMode || 'multiplier';
    $('priorityValue').value = s.priorityValue ?? 1.5;
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
      priorityValue: Math.max(0, Number($('priorityValue').value) || 0)
    };
    try {
      await Settings.update(patch);
      $('priorityStatus').textContent = `Saved · lead ${patch.bookingLeadHours}h · priority ${patch.priorityMode} ${patch.priorityValue}`;
      Notify.toast('Settings saved', 'Booking/priority updated', 'success');
    } catch (e) {
      $('priorityStatus').textContent = 'Save failed: ' + e.message;
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
    const recips = (b.recipients || []).map((r) => r.name).join(', ') || '—';
    const typeCell = b.priority
      ? '<span class="badge broadcast">⚡ Priority</span>'
      : '<span class="badge">Normal</span>';
    const rowStyle = b.priority ? ' style="background:#fff4e5"' : '';
    return `<tr${rowStyle}>
      <td>${typeCell}</td>
      <td>${fmtDateTime(b.createdAt)}</td>
      <td>${b.scheduledAt ? fmtDateTime(b.scheduledAt) : '—'}</td>
      <td>${client ? client.name : b.clientId}</td>
      <td>${labelize(b.speciality)}${b.unitPrice ? ` (₹${b.unitPrice}×${(b.recipients||[]).length||1})` : ''}</td>
      <td style="font-size:12px">${recips}</td>
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

  // annotate distance from the chosen point (if set)
  const withDist = list.map((c) => ({
    cg: c,
    dist: f.point ? distanceKm(c.location, f.point) : null
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
    btn.addEventListener('click', async () => {
      const c = state.caregivers.find((x) => x.id === btn.dataset.approve);
      if (!c) return;
      c.status = CaregiverStatus.ACTIVE;
      // issue a login access code if none set yet
      if (!c.accessCode) c.accessCode = String(Math.floor(100000 + Math.random() * 900000));
      c.updatedAt = nowIso();
      await Data.write(COLLECTION.CAREGIVERS, c);
      Notify.toast('Approved', `${c.name} is now active · access code ${c.accessCode}`, 'success');
    });
  });

  $('registrationList').querySelectorAll('[data-reject]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const c = state.caregivers.find((x) => x.id === btn.dataset.reject);
      if (!c) return;
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

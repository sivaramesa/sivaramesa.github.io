/* Caregiver PWA controller.
 *
 * Covers the caregiver side of requirements 2, 4, 6, 8:
 *   sign in -> toggle availability -> watch the queue of broadcast requests
 *   they're eligible for -> accept one (start code issued) -> start travel and
 *   share live location -> mark arrival -> request completion (completion code
 *   issued to the client).
 */
import { Availability, BookingStatus, CaregiverStatus, Speciality, nowIso, createCaregiver } from '../shared/models.js';
import { COLLECTION } from '../shared/firebase.js';
import { Data, Sync } from '../shared/sync.js';
import { Auth } from '../shared/auth.js';
import { Lifecycle } from '../shared/lifecycle.js';
import { Notify } from '../shared/notify.js';
import { eligibleCaregivers, distanceKm, caregiverDistanceKm, checkProximity } from '../shared/geo.js';
import { currentPosition, watchPosition, geocode } from '../shared/maps.js';
import { CONFIG } from '../shared/config.js';
import { Settings } from '../shared/settings.js';
import { registerWithUpdates } from '../shared/pwa-update.js';
import { Aadhaar, isValidAadhaarFormat } from '../shared/aadhaar.js';
import { compressPhoto, compressCertificate } from '../shared/imaging.js';

const $ = (id) => document.getElementById(id);

const state = {
  cg: null,
  bookings: [],
  activeJobId: null,
  stopWatch: null,
  pingTimer: null,
  unsub: null
};

async function boot() {
  registerServiceWorker();
  Sync.start();
  Sync.onStatus(renderSyncDot);
  Settings.subscribe(() => {}); // keep Settings.current() fresh for the complete gate

  const sess = Auth.session();
  if (sess && sess.role === 'caregiver') {
    state.cg = await Data.get(COLLECTION.CAREGIVERS, sess.userId);
    if (state.cg) return enterApp();
  }
  $('loginView').classList.remove('hidden');
}

function renderSyncDot(status) {
  const dot = $('syncDot');
  dot.className = 'status-dot ' + (!status.online ? 'red' : status.pending ? 'amber' : 'green');
  dot.title = !status.online ? 'offline' : status.pending ? `${status.pending} pending` : 'synced';
}

// ── login ─────────────────────────────────────────────────────────────────────
$('loginBtn').addEventListener('click', async () => {
  const phone = $('loginPhone').value.trim();
  const code = $('loginCode').value.trim();
  if (!phone || !code) return Notify.toast('Sign in', 'Enter phone and access code', 'error');

  const all = await Data.getAll(COLLECTION.CAREGIVERS);
  const rec = all.find((c) => (c.phone || '').replace(/\s/g, '') === phone.replace(/\s/g, ''));
  if (!rec) return Notify.toast('Not found', 'No caregiver with that number. Register first.', 'error');

  // Registration gate: only ACTIVE (admin-approved) caregivers may log in.
  const status = rec.status || CaregiverStatus.ACTIVE; // legacy records w/o status = active
  if (status === CaregiverStatus.REGISTERED) {
    return Notify.toast('Awaiting approval', 'Your registration is under review by the admin.', 'error');
  }
  if (status === CaregiverStatus.REJECTED) {
    return Notify.toast('Registration rejected', 'Your registration was not approved. Contact admin.', 'error');
  }

  try {
    await Auth.signInWithSecretCode(rec, code);
    state.cg = rec;
    Notify.registerDevice(async (token) => {
      rec.fcmToken = token; rec.updatedAt = nowIso();
      await Data.write(COLLECTION.CAREGIVERS, rec);
    });
    enterApp();
  } catch (e) {
    Notify.toast('Sign in failed', e.message, 'error');
  }
});

// ── registration ────────────────────────────────────────────────────────────
const reg = {
  photo: null,
  addressGeo: null,      // { address, lat, lng }
  opGeo: null,           // { address, lat, lng }
  certificates: [],      // [{ name, dataUrl }]
  specs: new Set(),
  aadhaarTxnId: null,
  aadhaarVerified: false
};

function labelizeSvc(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function showRegister() {
  $('loginView').classList.add('hidden');
  $('registerView').classList.remove('hidden');
  // build speciality chips once
  if (!$('regSpecs').dataset.built) {
    $('regSpecs').innerHTML = Object.values(Speciality).map((s) =>
      `<label style="flex:0 0 auto"><input type="checkbox" value="${s}" class="reg-spec" /> ${labelizeSvc(s)}</label>`).join('');
    $('regSpecs').dataset.built = '1';
    $('regSpecs').querySelectorAll('.reg-spec').forEach((cb) => {
      cb.addEventListener('change', () => cb.checked ? reg.specs.add(cb.value) : reg.specs.delete(cb.value));
    });
  }
}
function showLogin() {
  $('registerView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
}

document.getElementById('showRegister').addEventListener('click', (e) => { e.preventDefault(); showRegister(); });
document.getElementById('showLogin').addEventListener('click', (e) => { e.preventDefault(); showLogin(); });

// operating-location toggle
$('regSameLocation').addEventListener('change', () => {
  $('regOpBox').classList.toggle('hidden', $('regSameLocation').checked);
});

// photo
$('regPhoto').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try {
    reg.photo = await compressPhoto(f);
    $('regPhotoPreview').src = reg.photo;
    $('regPhotoPreview').style.display = 'block';
  } catch (_) { Notify.toast('Photo', 'Could not read that image', 'error'); }
});

// address geocode
$('regGeoAddress').addEventListener('click', async () => {
  const addr = $('regAddress').value.trim();
  if (!addr) return;
  $('regAddressGeo').textContent = 'Locating…';
  try {
    const res = await geocode(addr);
    reg.addressGeo = res
      ? { address: res.address, lat: res.lat, lng: res.lng }
      : { address: addr, lat: null, lng: null };
    $('regAddressGeo').textContent = res ? `Located: ${res.address}` : 'Saved address (no map pin).';
  } catch (e) {
    reg.addressGeo = { address: addr, lat: null, lng: null };
    $('regAddressGeo').textContent = 'Map unavailable: ' + (e.message || 'could not locate');
  }
});

// operating location geocode
$('regGeoOp').addEventListener('click', async () => {
  const addr = $('regOpAddress').value.trim();
  if (!addr) return;
  $('regOpGeo').textContent = 'Locating…';
  try {
    const res = await geocode(addr);
    reg.opGeo = res
      ? { address: res.address, lat: res.lat, lng: res.lng }
      : { address: addr, lat: null, lng: null };
    $('regOpGeo').textContent = res ? `Located: ${res.address}` : 'Saved address (no map pin).';
  } catch (e) {
    reg.opGeo = { address: addr, lat: null, lng: null };
    $('regOpGeo').textContent = 'Map unavailable: ' + (e.message || 'could not locate');
  }
});

// certificates (max 3, compressed + size-capped)
$('regCerts').addEventListener('change', async (e) => {
  const files = [...(e.target.files || [])].slice(0, 3);
  reg.certificates = [];
  $('regCertList').textContent = 'Processing…';
  const names = [];
  for (const f of files) {
    try {
      const dataUrl = await compressCertificate(f);
      reg.certificates.push({ name: f.name, dataUrl });
      names.push(f.name);
    } catch (err) {
      Notify.toast('Certificate', err.message, 'error');
    }
  }
  $('regCertList').textContent = names.length ? `Attached: ${names.join(', ')}` : 'No certificates attached.';
});

// Aadhaar OTP
$('regSendOtp').addEventListener('click', async () => {
  const num = $('regAadhaar').value.trim();
  if (!isValidAadhaarFormat(num)) return Notify.toast('Aadhaar', 'Enter a valid 12-digit number', 'error');
  $('regAadhaarStatus').textContent = 'Sending OTP…';
  const res = await Aadhaar.sendOtp(num);
  if (!res.ok) { $('regAadhaarStatus').textContent = res.error; return; }
  reg.aadhaarTxnId = res.txnId;
  $('regOtpBox').classList.remove('hidden');
  // dev hint only appears with the mock provider
  $('regAadhaarStatus').textContent = res.devHint ? `OTP sent (demo OTP: ${res.devHint})` : 'OTP sent to registered mobile.';
});

$('regVerifyOtp').addEventListener('click', async () => {
  const res = await Aadhaar.verifyOtp(reg.aadhaarTxnId, $('regOtp').value.trim());
  if (!res.ok) { $('regAadhaarStatus').textContent = res.error; return; }
  reg.aadhaarVerified = true;
  $('regAadhaarStatus').textContent = '✓ Aadhaar verified';
  $('regOtpBox').classList.add('hidden');
});

// submit
$('regSubmit').addEventListener('click', async () => {
  const forename = $('regForename').value.trim();
  const surname = $('regSurname').value.trim();
  const phone = $('regPhone').value.trim();
  const dob = $('regDob').value;

  if (!forename || !surname) return Notify.toast('Registration', 'Enter your name', 'error');
  if (!phone) return Notify.toast('Registration', 'Enter your mobile number', 'error');
  if (reg.specs.size === 0) return Notify.toast('Registration', 'Pick at least one specialisation', 'error');
  if (!reg.addressGeo) return Notify.toast('Registration', 'Locate your address', 'error');
  if (!reg.aadhaarVerified) return Notify.toast('Registration', 'Verify your Aadhaar via OTP first', 'error');

  // ensure no phone clash with an existing caregiver
  const existing = await Data.getAll(COLLECTION.CAREGIVERS);
  if (existing.some((c) => (c.phone || '').replace(/\s/g, '') === phone.replace(/\s/g, ''))) {
    return Notify.toast('Registration', 'A caregiver with this number already exists.', 'error');
  }

  const opGeo = $('regSameLocation').checked ? reg.addressGeo : (reg.opGeo || reg.addressGeo);
  const cg = createCaregiver({
    forename, surname, phone, dob,
    sex: $('regSex').value,
    specialities: [...reg.specs],
    photo: reg.photo,
    address: reg.addressGeo,
    operatingLocation: opGeo,
    aadhaar: { number: $('regAadhaar').value.trim(), verified: true },
    certificates: reg.certificates,
    status: CaregiverStatus.REGISTERED
  });

  const btn = $('regSubmit');
  btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    await Data.write(COLLECTION.CAREGIVERS, cg);
    Notify.toast('Registered', 'Submitted for admin approval. You can log in once activated.', 'success');
    showLogin();
  } catch (e) {
    Notify.toast('Registration failed', e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Submit registration';
  }
});

// ── enter app ──────────────────────────────────────────────────────────────────
function enterApp() {
  $('loginView').classList.add('hidden');
  $('availView').classList.remove('hidden');
  $('queueView').classList.remove('hidden');
  $('cgHello').textContent = `Hi, ${state.cg.name}`;
  $('cgSkills').textContent = (state.cg.specialities || []).map(labelize).join(', ');
  renderAvailability();

  if (state.unsub) state.unsub();
  state.unsub = Sync.subscribe(COLLECTION.BOOKINGS, (all) => {
    const prevJobId = state.activeJobId;
    state.bookings = all;
    // is there a job assigned to me still in progress?
    const active = all.find((b) =>
      b.caregiverId === state.cg.id &&
      ![BookingStatus.COMPLETED, BookingStatus.CANCELLED, BookingStatus.EXPIRED].includes(b.status));
    if (active) { state.activeJobId = active.id; renderJob(active); return; }

    // no active job. If I *had* one and it just got cancelled, land cleanly.
    if (prevJobId) {
      const prev = all.find((b) => b.id === prevJobId);
      if (prev && prev.status === BookingStatus.CANCELLED) {
        stopSharing();                                   // kill location watch/ping
        // mirror the server-side free so my queue/badge reflect availability
        if (state.cg.availability === Availability.ON_SERVICE) {
          state.cg.availability = Availability.AVAILABLE;
        }
        renderAvailability();
        const reason = prev.cancelReason ? ` (${prev.cancelReason})` : '';
        Notify.toast('Job cancelled', `This job was cancelled${reason}. You're available again.`, 'info');
      }
    }
    state.activeJobId = null;
    $('jobView').classList.add('hidden');
    renderQueue();
  });
}

// ── availability toggle (req 2: choose available / not any time) ────────────────
$('goAvailable').addEventListener('click', () => setAvailability(Availability.AVAILABLE));
$('goUnavailable').addEventListener('click', () => setAvailability(Availability.UNAVAILABLE));

async function setAvailability(value) {
  // capture current location when going available so matching works
  if (value === Availability.AVAILABLE) {
    try {
      const pos = await currentPosition();
      state.cg.location = { lat: pos.lat, lng: pos.lng, at: nowIso() };
      $('locNote').textContent = 'Location shared for matching.';
    } catch (_) {
      $('locNote').textContent = 'Could not read location — requests may not match by distance.';
    }
  }
  state.cg.availability = value;
  state.cg.updatedAt = nowIso();
  await Data.write(COLLECTION.CAREGIVERS, state.cg);
  renderAvailability();
  renderQueue();
}

function renderAvailability() {
  const a = state.cg.availability;
  $('availBadge').className = 'badge ' + (a === Availability.AVAILABLE ? 'in_service' : a === Availability.ON_SERVICE ? 'accepted' : 'cancelled');
  $('availBadge').textContent = labelize(a);
}

// ── request queue (req 3/4: see broadcast requests I'm eligible for) ────────────
function renderQueue() {
  const list = $('queueList');
  const meInvited = (b) => Array.isArray(b.invitedCaregiverIds) && b.invitedCaregiverIds.includes(state.cg.id);
  const open = state.bookings.filter((b) => b.status === BookingStatus.BROADCAST);
  const anyInvite = open.some(meInvited);

  // If I'm on a job, nothing to show. If I'm not "available", I still see admin
  // invites (high precedence) — but not the general broadcast queue.
  if (state.activeJobId || (state.cg.availability !== Availability.AVAILABLE && !anyInvite)) {
    list.innerHTML = '';
    $('queueEmpty').classList.toggle('hidden', !!state.activeJobId);
    $('queueEmpty').textContent = state.activeJobId
      ? 'You have an active job.'
      : 'Go available to receive requests.';
    return;
  }

  const matchMode = Settings.current().matchLocationMode || 'gps';
  const available = state.cg.availability === Availability.AVAILABLE;
  // Show a request if I'm invited (bypasses radius; speciality still required),
  // or — when available — I match speciality + range via the normal rule.
  const forMe = open.filter((b) => {
    const specOk = Array.isArray(state.cg.specialities) && state.cg.specialities.includes(b.speciality);
    if (meInvited(b)) return specOk;
    if (!available) return false;
    return eligibleCaregivers(b, [state.cg], b.radiusKm, matchMode).length > 0;
  });

  // invited requests first (high precedence)
  forMe.sort((a, b) => (meInvited(b) ? 1 : 0) - (meInvited(a) ? 1 : 0));

  $('queueEmpty').classList.toggle('hidden', forMe.length > 0);
  list.innerHTML = forMe.map((b) => {
    const invited = meInvited(b);
    const dist = caregiverDistanceKm(state.cg, b, matchMode);
    const distTxt = dist != null && isFinite(dist) ? `${dist.toFixed(1)} km away` : 'distance n/a';
    const when = b.scheduledAt ? new Date(b.scheduledAt).toLocaleString() : '';
    const forCount = (b.recipients || []).length;
    const bg = invited ? '#e8f7ee' : (b.priority ? '#fff4e5' : '#f8fafc');
    return `<div class="card" style="background:${bg}">
      <div style="display:flex;justify-content:space-between">
        <strong>${b.priority ? '⚡ ' : ''}${b.clonedFrom ? '↻ ' : ''}${labelize(b.speciality)}</strong><span>₹${b.price}</span>
      </div>
      ${invited ? '<div><span class="badge in_service">★ Admin invite — priority</span></div>' : ''}
      <div class="muted">${b.location.address || b.location.label} · ${distTxt}</div>
      ${when ? `<div class="muted">When: ${when}</div>` : ''}
      ${forCount ? `<div class="muted">${forCount} recipient${forCount === 1 ? '' : 's'}</div>` : ''}
      <button class="btn ok small" data-accept="${b.id}" style="margin-top:8px">Accept</button>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-accept]').forEach((btn) => {
    btn.addEventListener('click', () => acceptJob(btn.dataset.accept));
  });
}

async function acceptJob(bookingId) {
  const b = await Data.get(COLLECTION.BOOKINGS, bookingId);
  if (!b || b.status !== BookingStatus.BROADCAST) {
    return Notify.toast('Too late', 'This request was already taken.', 'error');
  }
  try {
    await Lifecycle.accept(b, state.cg);            // req 4: confirm + issue start code
    state.cg.availability = Availability.ON_SERVICE;
    Notify.toast('Job accepted', 'Start code issued. Share it with the client on arrival.', 'success');
  } catch (e) {
    Notify.toast('Accept failed', e.message, 'error');
  }
}

// ── active job rendering ────────────────────────────────────────────────────────
function renderJob(b) {
  $('jobView').classList.remove('hidden');
  $('queueView').classList.add('hidden');

  $('jobStatus').className = 'badge ' + b.status;
  $('jobStatus').textContent = labelize(b.status);
  {
    const when = b.scheduledAt ? new Date(b.scheduledAt).toLocaleString() : '';
    const forWhom = (b.recipients || []).map((r) => r.name).join(', ');
    $('jobSummary').innerHTML = `${labelize(b.speciality)} · ${b.location.address || b.location.label} · ₹${b.price}`
      + (when ? `<br><span class="muted">When: ${when}</span>` : '')
      + (forWhom ? `<br><span class="muted">For: ${forWhom}</span>` : '');
  }

  // start code visible to caregiver from acceptance onward
  const showStart = b.codes.startCode && [BookingStatus.ACCEPTED, BookingStatus.EN_ROUTE, BookingStatus.ARRIVED].includes(b.status);
  $('startCodeBox').classList.toggle('hidden', !showStart);
  if (showStart) $('startCodeChip').textContent = b.codes.startCode;

  // action buttons by state
  $('startTravelBtn').classList.toggle('hidden', b.status !== BookingStatus.ACCEPTED);
  $('arrivedBtn').classList.toggle('hidden', b.status !== BookingStatus.EN_ROUTE);
  $('completeBtn').classList.toggle('hidden', b.status !== BookingStatus.IN_SERVICE);

  const showComplete = b.status === BookingStatus.COMPLETION_PENDING;
  $('completeCodeBox').classList.toggle('hidden', !showComplete);
  if (showComplete) $('completeCodeChip').textContent = b.codes.completeCode;

  if (b.status === BookingStatus.COMPLETED) {
    $('jobLive').textContent = 'Service completed. You are available again.';
    stopSharing();
  } else if (b.status === BookingStatus.EN_ROUTE) {
    $('jobLive').textContent = `Sharing live location · ETA ~${b.tracking?.etaMinutes ?? '—'} min`;
  } else {
    $('jobLive').textContent = '';
  }
}

// req 6: start travel -> establish navigation + share live location
$('startTravelBtn').addEventListener('click', async () => {
  const b = await Data.get(COLLECTION.BOOKINGS, state.activeJobId);
  try {
    await Lifecycle.startTravel(b, state.cg);
    startSharing(b.id);
    // open turn-by-turn navigation in Google Maps (Navigation SDK equivalent)
    if (b.location.lat != null) {
      const url = `https://www.google.com/maps/dir/?api=1&destination=${b.location.lat},${b.location.lng}&travelmode=driving`;
      const win = window.open(url, '_blank');
      if (!win) Notify.toast('Navigation', 'Allow pop-ups to open turn-by-turn directions.', 'error');
    } else {
      Notify.toast('Navigation', 'Client address has no map pin — navigate manually.', 'info');
    }
    Notify.toast('Travelling', 'Live location is now shared with the client.', 'info');
  } catch (e) {
    Notify.toast('Could not start', e.message, 'error');
  }
});

function startSharing(bookingId) {
  stopSharing();
  const ping = async (lat, lng) => {
    state.cg.location = { lat, lng, at: nowIso() };
    Data.write(COLLECTION.CAREGIVERS, state.cg);
    const b = await Data.get(COLLECTION.BOOKINGS, bookingId);
    if (b && b.status === BookingStatus.EN_ROUTE) await Lifecycle.pushLocation(b, lat, lng);
  };
  // continuous watch + a steady interval fallback
  state.stopWatch = watchPosition(
    (p) => ping(p.lat, p.lng),
    (err) => Notify.toast('Location sharing',
      'Cannot read location — the client may not see you move. ' + (err && err.message ? err.message : ''),
      'error')
  );
  state.pingTimer = setInterval(async () => {
    try { const p = await currentPosition(); ping(p.lat, p.lng); } catch (_) {}
  }, CONFIG.rules.locationPingMs);
}

function stopSharing() {
  if (state.stopWatch) { state.stopWatch(); state.stopWatch = null; }
  if (state.pingTimer) { clearInterval(state.pingTimer); state.pingTimer = null; }
}

// req 7: arrival — keep sharing location so the client's start gate and the
// caregiver's own complete gate have a fresh position (needed when location
// verification is enabled).
$('arrivedBtn').addEventListener('click', async () => {
  const b = await Data.get(COLLECTION.BOOKINGS, state.activeJobId);
  // push one fresh location immediately, then keep the watch running
  try { const p = await currentPosition(); await Lifecycle.pushLocation(b, p.lat, p.lng); } catch (_) {}
  await Lifecycle.markArrived(b);
  startSharing(b.id); // keep location fresh through ARRIVED / IN_SERVICE
  Notify.toast('Arrived', 'Read the start code to the client to begin the service.', 'info');
});

// req 8: request completion -> completion code issued to client.
// Gated by proximity when location verification is enabled.
$('completeBtn').addEventListener('click', async () => {
  const b = await Data.get(COLLECTION.BOOKINGS, state.activeJobId);
  const s = Settings.current();
  if (s.locationVerification) {
    let here = null;
    try { here = await currentPosition(); } catch (_) {}
    const verdict = checkProximity(here, b.location, s);
    if (!verdict.ok) {
      const msg = verdict.reason === 'location unavailable'
        ? 'Cannot read your location — required to complete service.'
        : `You are ${verdict.distanceMeters ?? '—'} m away. Must be within ${s.verifyRadiusMeters} m to complete.`;
      return Notify.toast('Location check', msg, 'error');
    }
  }
  await Lifecycle.requestCompletion(b);
  stopSharing();
  Notify.toast('Completion requested', 'Client will confirm with the completion code + rating.', 'info');
});

// ── helpers ───────────────────────────────────────────────────────────────────
function labelize(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function registerServiceWorker() {
  registerWithUpdates('./sw.js');
}

boot();

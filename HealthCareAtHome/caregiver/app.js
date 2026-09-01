/* Caregiver PWA controller.
 *
 * Covers the caregiver side of requirements 2, 4, 6, 8:
 *   sign in -> toggle availability -> watch the queue of broadcast requests
 *   they're eligible for -> accept one (start code issued) -> start travel and
 *   share live location -> mark arrival -> request completion (completion code
 *   issued to the client).
 */
import { Availability, BookingStatus, nowIso } from '../shared/models.js';
import { COLLECTION } from '../shared/firebase.js';
import { Data, Sync } from '../shared/sync.js';
import { Auth } from '../shared/auth.js';
import { Lifecycle } from '../shared/lifecycle.js';
import { Notify } from '../shared/notify.js';
import { eligibleCaregivers, distanceKm, checkProximity } from '../shared/geo.js';
import { currentPosition, watchPosition } from '../shared/maps.js';
import { CONFIG } from '../shared/config.js';
import { Settings } from '../shared/settings.js';

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
  if (!rec) return Notify.toast('Not found', 'No caregiver with that number. Contact admin.', 'error');

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
    state.bookings = all;
    // is there a job assigned to me still in progress?
    const active = all.find((b) =>
      b.caregiverId === state.cg.id &&
      ![BookingStatus.COMPLETED, BookingStatus.CANCELLED, BookingStatus.EXPIRED].includes(b.status));
    if (active) { state.activeJobId = active.id; renderJob(active); }
    else { state.activeJobId = null; $('jobView').classList.add('hidden'); renderQueue(); }
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
  if (state.activeJobId || state.cg.availability !== Availability.AVAILABLE) {
    list.innerHTML = '';
    $('queueEmpty').classList.toggle('hidden', !!state.activeJobId);
    $('queueEmpty').textContent = state.activeJobId
      ? 'You have an active job.'
      : 'Go available to receive requests.';
    return;
  }

  const open = state.bookings.filter((b) => b.status === BookingStatus.BROADCAST);
  // keep only requests where I match speciality + range
  const forMe = open.filter((b) => {
    const ok = eligibleCaregivers(b, [state.cg], b.radiusKm);
    return ok.length > 0;
  });

  $('queueEmpty').classList.toggle('hidden', forMe.length > 0);
  list.innerHTML = forMe.map((b) => {
    const dist = state.cg.location ? distanceKm(state.cg.location, b.location) : null;
    const distTxt = dist != null && isFinite(dist) ? `${dist.toFixed(1)} km away` : 'distance n/a';
    return `<div class="card" style="background:#f8fafc">
      <div style="display:flex;justify-content:space-between">
        <strong>${labelize(b.speciality)}</strong><span>₹${b.price}</span>
      </div>
      <div class="muted">${b.location.address || b.location.label} · ${distTxt}</div>
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
  $('jobSummary').textContent = `${labelize(b.speciality)} · ${b.location.address || b.location.label} · ₹${b.price}`;

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
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

boot();

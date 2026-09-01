/* Client PWA controller.
 *
 * Covers the client side of requirements 1–9:
 *   sign in -> book service (saved or new location) -> pay -> (caregiver
 *   alerted automatically) -> see assigned caregiver -> live-track their
 *   travel -> verify start code on arrival -> verify completion code + rate.
 *
 * All reads come from the live bookings feed (Sync.subscribe), so the view
 * reacts in real time as the caregiver progresses through the lifecycle.
 */
import { Speciality, BookingStatus, createBooking, nowIso } from '../shared/models.js';
import { COLLECTION } from '../shared/firebase.js';
import { Data, Sync } from '../shared/sync.js';
import { Auth } from '../shared/auth.js';
import { Lifecycle } from '../shared/lifecycle.js';
import { Notify } from '../shared/notify.js';
import { geocode, createLiveMap } from '../shared/maps.js';
import { CONFIG } from '../shared/config.js';
import { Settings } from '../shared/settings.js';
import { checkProximity, eligibleCaregivers } from '../shared/geo.js';
import { registerWithUpdates } from '../shared/pwa-update.js';

const $ = (id) => document.getElementById(id);

const state = {
  client: null,
  activeBookingId: null,
  caregivers: [],
  liveMap: null,
  pendingLocation: null,
  stars: 0,
  unsubBookings: null,
  settings: { locationVerification: false, verifyRadiusMeters: 50 },
  currentBooking: null
};

// ── boot ──────────────────────────────────────────────────────────────────
async function boot() {
  registerServiceWorker();
  Sync.start();
  Sync.onStatus(renderSyncDot);

  // keep a live copy of caregivers (public profiles) for display; re-render the
  // active booking so the "available within range" count stays live.
  Sync.subscribe(COLLECTION.CAREGIVERS, (list) => {
    state.caregivers = list;
    if (state.currentBooking) renderActive(state.currentBooking);
  });

  // live location-verification policy; re-render the active booking on change
  Settings.subscribe((s) => {
    state.settings = s;
    if (state.currentBooking) renderActive(state.currentBooking);
  });

  const sess = Auth.session();
  if (sess && sess.role === 'client') {
    state.client = await Data.get(COLLECTION.CLIENTS, sess.userId);
    if (state.client) return enterApp();
  }
  showLogin();
}

function renderSyncDot(status) {
  const dot = $('syncDot');
  dot.className = 'status-dot ' + (!status.online ? 'red' : status.pending ? 'amber' : 'green');
  dot.title = !status.online ? 'offline' : status.pending ? `${status.pending} pending` : 'synced';
}

// ── login ───────────────────────────────────────────────────────────────────
function showLogin() {
  $('loginView').classList.remove('hidden');
  $('bookView').classList.add('hidden');
  $('activeView').classList.add('hidden');
}

$('loginBtn').addEventListener('click', async () => {
  const phone = $('loginPhone').value.trim();
  const code = $('loginCode').value.trim();
  if (!phone || !code) return Notify.toast('Sign in', 'Enter phone and access code', 'error');

  // Look up the client record by phone from the mirror/feed.
  const clients = await Data.getAll(COLLECTION.CLIENTS);
  const rec = clients.find((c) => (c.phone || '').replace(/\s/g, '') === phone.replace(/\s/g, ''));
  if (!rec) return Notify.toast('Not found', 'No client with that number. Contact admin.', 'error');

  try {
    await Auth.signInWithSecretCode(rec, code);
    state.client = rec;
    Notify.registerDevice(async (token) => {
      rec.fcmToken = token; rec.updatedAt = nowIso();
      await Data.write(COLLECTION.CLIENTS, rec);
    });
    enterApp();
  } catch (e) {
    Notify.toast('Sign in failed', e.message, 'error');
  }
});

// ── enter app: subscribe to my bookings ──────────────────────────────────────
function enterApp() {
  $('loginView').classList.add('hidden');
  populateSpecialities();
  populateSavedLocations();

  if (state.unsubBookings) state.unsubBookings();
  state.unsubBookings = Sync.subscribe(COLLECTION.BOOKINGS, (all) => {
    const mine = all
      .filter((b) => b.clientId === state.client.id)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const active = mine.find((b) => ![BookingStatus.COMPLETED, BookingStatus.CANCELLED, BookingStatus.EXPIRED].includes(b.status));
    if (active) { state.activeBookingId = active.id; renderActive(active); }
    else if (state.activeBookingId) {
      const done = mine.find((b) => b.id === state.activeBookingId);
      if (done) renderActive(done); else showBook();
    } else {
      showBook();
    }
  });
}

function showBook() {
  $('bookView').classList.remove('hidden');
  $('activeView').classList.add('hidden');
}

function populateSpecialities() {
  const sel = $('speciality');
  sel.innerHTML = Object.values(Speciality)
    .map((s) => `<option value="${s}">${labelize(s)}</option>`).join('');
}

function populateSavedLocations() {
  const sel = $('savedLocation');
  const opts = (state.client.savedLocations || [])
    .map((l, i) => `<option value="${i}">${l.label}: ${l.address}</option>`).join('');
  sel.innerHTML = opts + '<option value="new">➕ New location…</option>';
  toggleNewLocation();
}

$('savedLocation').addEventListener('change', toggleNewLocation);
function toggleNewLocation() {
  const isNew = $('savedLocation').value === 'new';
  $('newLocationBox').classList.toggle('hidden', !isNew);
}

$('geocodeBtn').addEventListener('click', async () => {
  const addr = $('newAddress').value.trim();
  if (!addr) return;
  $('geoResult').textContent = 'Locating…';
  try {
    const res = await geocode(addr);
    if (res) {
      state.pendingLocation = { label: 'New', address: res.address, lat: res.lat, lng: res.lng };
      $('geoResult').textContent = `Located: ${res.address}`;
    } else {
      // SDK is fine but the address didn't resolve — keep the raw address.
      state.pendingLocation = { label: 'New', address: addr, lat: null, lng: null };
      $('geoResult').textContent = 'Address not found — saved as typed (no map pin).';
    }
  } catch (e) {
    // The Maps SDK itself failed to load — surface the real reason.
    state.pendingLocation = { label: 'New', address: addr, lat: null, lng: null };
    $('geoResult').textContent = 'Map unavailable: ' + (e && e.message ? e.message : 'could not load Google Maps.');
  }
});

// ── book + pay ────────────────────────────────────────────────────────────────
$('payBookBtn').addEventListener('click', async () => {
  const btn = $('payBookBtn');
  let location;
  if ($('savedLocation').value === 'new') {
    location = state.pendingLocation || (() => {
      const addr = $('newAddress').value.trim();
      return addr ? { label: 'New', address: addr, lat: null, lng: null } : null;
    })();
  } else {
    location = state.client.savedLocations[Number($('savedLocation').value)];
  }
  if (!location) return Notify.toast('Location', 'Choose or locate a service address', 'error');

  const booking = createBooking({
    clientId: state.client.id,
    speciality: $('speciality').value,
    location,
    price: Number($('price').value) || 0,
    radiusKm: Number($('radiusKm').value) || CONFIG.rules.defaultMatchRadiusKm
  });

  btn.disabled = true; btn.textContent = 'Processing payment…';
  try {
    await Data.write(COLLECTION.BOOKINGS, booking);          // persist created
    await Lifecycle.pay(booking);                            // req 3: capture payment
    Notify.toast('Payment received', 'Alerting nearby caregivers…', 'success');
    const { notified } = await Lifecycle.broadcast(booking, state.caregivers, booking.radiusKm); // req 3
    state.activeBookingId = booking.id;
    Notify.toast('Request sent', `${notified.length} caregiver(s) alerted`, 'info');
  } catch (e) {
    Notify.toast('Booking failed', e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Pay & request caregiver';
  }
});

// ── render active booking (drives every downstream stage) ────────────────────
async function renderActive(b) {
  state.currentBooking = b;
  $('bookView').classList.add('hidden');
  $('activeView').classList.remove('hidden');

  $('activeStatus').className = 'badge ' + b.status;
  $('activeStatus').textContent = labelize(b.status);
  $('activeSummary').textContent =
    `${labelize(b.speciality)} · ${b.location.address || b.location.label} · ₹${b.price}`;

  // live count of caregivers actively available within range, while broadcasting
  const showAvail = b.status === BookingStatus.BROADCAST;
  $('availabilityBox').classList.toggle('hidden', !showAvail);
  if (showAvail) {
    const count = eligibleCaregivers(b, state.caregivers, b.radiusKm).length;
    $('availabilityLine').innerHTML = count > 0
      ? `<strong>${count}</strong> caregiver${count === 1 ? '' : 's'} available within ${b.radiusKm} km — waiting for one to accept…`
      : `No caregivers currently available within ${b.radiusKm} km. Waiting for someone to come online…`;
  }

  // assigned caregiver card (req 4: details shared with client)
  const hasCg = !!b.caregiverId;
  $('caregiverBox').classList.toggle('hidden', !hasCg);
  if (hasCg) {
    const cg = state.caregivers.find((c) => c.id === b.caregiverId);
    $('cgName').textContent = cg ? cg.name : b.caregiverName || 'Caregiver';
    $('cgMeta').textContent = cg
      ? `${(cg.specialities || []).map(labelize).join(', ')} · ★ ${cg.rating || 'new'}`
      : '';
    const photoEl = $('cgPhoto');
    if (cg && cg.photo) { photoEl.src = cg.photo; photoEl.style.display = 'block'; }
    else { photoEl.removeAttribute('src'); photoEl.style.display = 'none'; }

    // show the start code in the caregiver card from acceptance onward
    // (before the caregiver's own start box appears), masked per the gate.
    const preArrival = [BookingStatus.ACCEPTED, BookingStatus.EN_ROUTE].includes(b.status);
    $('cgStartCodeWrap').classList.toggle('hidden', !preArrival);
    if (preArrival) $('cgStartCode').textContent = startCodeDisplay(b).text;
  }

  // toggle stage-specific panels
  const showTrack = [BookingStatus.EN_ROUTE, BookingStatus.ARRIVED].includes(b.status);
  $('trackBox').classList.toggle('hidden', !showTrack);
  const showStartVerify = b.status === BookingStatus.ARRIVED;
  $('startVerifyBox').classList.toggle('hidden', !showStartVerify);
  if (showStartVerify) {
    $('startCodeShown').textContent = b.codes.startCode || '——————';
    applyStartProximityGate(b);
  }
  const showComplete = b.status === BookingStatus.COMPLETION_PENDING;
  $('completeBox').classList.toggle('hidden', !showComplete);
  if (showComplete) $('completeCodeShown').textContent = b.codes.completeCode || '——————';
  $('doneBox').classList.toggle('hidden', b.status !== BookingStatus.COMPLETED);

  if (showTrack) await renderLiveTracking(b);
}

async function renderLiveTracking(b) {
  if (b.location.lat == null) { $('etaLine').textContent = 'Live map needs a mapped address.'; return; }
  if (!state.liveMap) {
    state.liveMap = await createLiveMap($('map'), { lat: b.location.lat, lng: b.location.lng });
  }
  if (!state.liveMap) {
    // createLiveMap already wrote the reason into the map container.
    $('etaLine').textContent = b.tracking && b.tracking.etaMinutes != null
      ? `ETA ~${b.tracking.etaMinutes} min (map unavailable)`
      : 'Map unavailable — tracking by status only.';
    return;
  }
  if (state.liveMap && b.tracking && b.tracking.lat != null) {
    const info = await state.liveMap.update(b.tracking.lat, b.tracking.lng);
    $('etaLine').textContent = info
      ? `Caregiver ${info.distanceText} away · ETA ${info.etaText}`
      : `ETA ~${b.tracking.etaMinutes ?? '—'} min`;
  } else {
    $('etaLine').textContent = 'Waiting for caregiver location…';
  }
}

/**
 * Single source of truth for whether the start code is revealed to the client.
 * When location verification is ON, the code is masked until the caregiver is
 * within range. When OFF, always revealed. Returns the current proximity
 * verdict too so the UI can show distance.
 */
function startCodeDisplay(b) {
  const s = state.settings;
  const real = b.codes.startCode || '——————';
  if (!s.locationVerification) return { text: real, unlocked: true, verdict: null };
  const caregiverLoc = b.tracking && b.tracking.lat != null
    ? { lat: b.tracking.lat, lng: b.tracking.lng } : null;
  const verdict = checkProximity(caregiverLoc, b.location, s);
  return { text: verdict.ok ? real : '••••••', unlocked: verdict.ok, verdict };
}

/**
 * Location-verification gate for starting service. When the flag is ON, the
 * client can only start (and only sees the real start code) once the caregiver
 * is within range. The caregiver's live position comes from booking.tracking
 * (shared through arrival). When the flag is OFF, always allow + show the code.
 */
function applyStartProximityGate(b) {
  const s = state.settings;
  const line = $('proximityLine');
  const btn = $('verifyStartBtn');
  const codeEl = $('startCodeShown');
  const disp = startCodeDisplay(b);

  codeEl.textContent = disp.text;
  btn.disabled = !disp.unlocked;

  if (!s.locationVerification) {
    line.classList.add('hidden');
    return;
  }

  line.classList.remove('hidden');
  if (disp.unlocked) {
    line.textContent = `Caregiver is within ${s.verifyRadiusMeters} m — you can start.`;
    line.style.color = 'var(--ok)';
  } else {
    line.style.color = 'var(--danger)';
    line.textContent = disp.verdict && disp.verdict.reason === 'location unavailable'
      ? 'Waiting for caregiver location… start unlocks when they are in range.'
      : `Caregiver is ${disp.verdict ? (disp.verdict.distanceMeters ?? '—') : '—'} m away. Start unlocks within ${s.verifyRadiusMeters} m.`;
  }
}

// ── req 7: verify start code ──────────────────────────────────────────────────
$('verifyStartBtn').addEventListener('click', async () => {
  const b = await Data.get(COLLECTION.BOOKINGS, state.activeBookingId);
  // re-check the gate at click time (defence in depth)
  if (state.settings.locationVerification) {
    const caregiverLoc = b.tracking && b.tracking.lat != null
      ? { lat: b.tracking.lat, lng: b.tracking.lng } : null;
    const verdict = checkProximity(caregiverLoc, b.location, state.settings);
    if (!verdict.ok) {
      return Notify.toast('Location check', 'Caregiver is not within range yet.', 'error');
    }
  }
  const { ok } = await Lifecycle.verifyStartCode(b, $('startCodeInput').value);
  Notify.toast(ok ? 'Verified' : 'Wrong code',
    ok ? 'Service started.' : 'Code did not match. Try again.', ok ? 'success' : 'error');
});

// ── rating stars ──────────────────────────────────────────────────────────────
$('starRow').addEventListener('click', (e) => {
  const v = Number(e.target.dataset.v || 0);
  if (!v) return;
  state.stars = v;
  [...$('starRow').children].forEach((s) => s.classList.toggle('on', Number(s.dataset.v) <= v));
});

// ── req 9: verify completion code + rating ───────────────────────────────────
$('verifyCompleteBtn').addEventListener('click', async () => {
  const b = await Data.get(COLLECTION.BOOKINGS, state.activeBookingId);
  const cg = state.caregivers.find((c) => c.id === b.caregiverId);
  const { ok } = await Lifecycle.verifyCompletion(
    b, $('completeCodeInput').value,
    { stars: state.stars, comments: $('commentInput').value.trim() },
    cg
  );
  Notify.toast(ok ? 'Completed' : 'Wrong code',
    ok ? 'Service officially completed. Thank you!' : 'Completion code did not match.',
    ok ? 'success' : 'error');
});

$('newBookingBtn').addEventListener('click', () => {
  state.activeBookingId = null;
  state.liveMap = null;
  state.stars = 0;
  showBook();
});

// ── helpers ───────────────────────────────────────────────────────────────────
function labelize(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function registerServiceWorker() {
  registerWithUpdates('./sw.js');
}

boot();

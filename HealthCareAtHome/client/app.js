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
import { Speciality, BookingStatus, createBooking, createClient, nowIso } from '../shared/models.js';
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
import { Services } from '../shared/services-master.js';
import { Aadhaar, isValidAadhaarFormat } from '../shared/aadhaar.js';
import { compressPhoto } from '../shared/imaging.js';

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
  currentBooking: null,
  services: []
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

  // live services master; refresh the booking form's service dropdown
  Services.subscribe((list) => {
    state.services = (list || []).filter((s) => s.active)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    populateSpecialities();
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
  $('registerView').classList.add('hidden');
}

// ── registration ────────────────────────────────────────────────────────────
// A "person" = self or a member. self has phone; members have relationship.
const regState = {
  self: { photo: null, addressGeo: null, aadhaarTxnId: null, aadhaarVerified: false },
  members: [] // each: { id, photo, addressGeo, sameAsPrimary, aadhaarTxnId, aadhaarVerified }
};

function labelizePerson(forename, surname) {
  return [forename, surname].filter(Boolean).join(' ').trim();
}

document.getElementById('showRegister').addEventListener('click', (e) => {
  e.preventDefault();
  $('loginView').classList.add('hidden');
  $('registerView').classList.remove('hidden');
});
document.getElementById('showLogin').addEventListener('click', (e) => {
  e.preventDefault();
  showLogin();
});

// self photo
$('regPhoto').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try {
    regState.self.photo = await compressPhoto(f);
    $('regPhotoPreview').src = regState.self.photo;
    $('regPhotoPreview').style.display = 'block';
  } catch (_) { Notify.toast('Photo', 'Could not read that image', 'error'); }
});

// self address geocode
$('regGeoAddress').addEventListener('click', async () => {
  const addr = $('regAddress').value.trim();
  if (!addr) return;
  $('regAddressGeo').textContent = 'Locating…';
  try {
    const res = await geocode(addr);
    regState.self.addressGeo = res ? { address: res.address, lat: res.lat, lng: res.lng } : { address: addr, lat: null, lng: null };
    $('regAddressGeo').textContent = res ? `Located: ${res.address}` : 'Saved address (no map pin).';
  } catch (err) {
    regState.self.addressGeo = { address: addr, lat: null, lng: null };
    $('regAddressGeo').textContent = 'Map unavailable: ' + (err.message || 'could not locate');
  }
});

// self Aadhaar OTP
$('regSendOtp').addEventListener('click', async () => {
  const num = $('regAadhaar').value.trim();
  if (!isValidAadhaarFormat(num)) return Notify.toast('Aadhaar', 'Enter a valid 12-digit number', 'error');
  $('regAadhaarStatus').textContent = 'Sending OTP…';
  const res = await Aadhaar.sendOtp(num);
  if (!res.ok) { $('regAadhaarStatus').textContent = res.error; return; }
  regState.self.aadhaarTxnId = res.txnId;
  $('regOtpBox').classList.remove('hidden');
  $('regAadhaarStatus').textContent = res.devHint ? `OTP sent (demo OTP: ${res.devHint})` : 'OTP sent.';
});
$('regVerifyOtp').addEventListener('click', async () => {
  const res = await Aadhaar.verifyOtp(regState.self.aadhaarTxnId, $('regOtp').value.trim());
  if (!res.ok) { $('regAadhaarStatus').textContent = res.error; return; }
  regState.self.aadhaarVerified = true;
  $('regAadhaarStatus').textContent = '✓ Aadhaar verified';
  $('regOtpBox').classList.add('hidden');
  refreshRegisterEnabled();
});

// ── member cards (dynamic) ────────────────────────────────────────────────────
let _memberSeq = 0;
$('regAddMember').addEventListener('click', () => addMemberCard());

function addMemberCard() {
  const mid = 'm' + (++_memberSeq);
  const m = { id: mid, photo: null, addressGeo: null, sameAsPrimary: true, aadhaarTxnId: null, aadhaarVerified: false };
  regState.members.push(m);

  const card = document.createElement('div');
  card.className = 'card';
  card.style.background = '#f8fafc';
  card.dataset.mid = mid;
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <strong>Member</strong>
      <button class="btn danger small" data-del style="max-width:90px">Remove</button>
    </div>
    <div class="row"><input data-f="forename" placeholder="Forename" /><input data-f="surname" placeholder="Surname" /></div>
    <div class="row">
      <select data-f="sex"><option value="">Sex…</option><option>Female</option><option>Male</option><option>Other</option></select>
      <input data-f="dob" type="date" />
    </div>
    <input data-f="relationship" placeholder="Relationship (optional)" />
    <label>Photo</label>
    <input data-f="photo" type="file" accept="image/*" />
    <img data-el="photoPrev" alt="" style="width:56px;height:56px;border-radius:50%;object-fit:cover;margin-top:6px;display:none" />
    <label style="margin-top:8px"><input type="checkbox" data-f="same" checked /> Address same as primary</label>
    <div data-el="addrBox" class="hidden">
      <input data-f="address" placeholder="Member address" />
      <button class="btn secondary small" data-act="geo" style="margin-top:6px">Locate address</button>
      <p class="muted" data-el="addrGeo"></p>
    </div>
    <label>Aadhaar number</label>
    <input data-f="aadhaar" inputmode="numeric" maxlength="12" placeholder="XXXXXXXXXXXX" />
    <button class="btn secondary small" data-act="sendOtp" style="margin-top:6px">Send OTP</button>
    <div data-el="otpBox" class="hidden" style="margin-top:8px">
      <input data-f="otp" inputmode="numeric" placeholder="6-digit OTP" />
      <button class="btn small" data-act="verifyOtp" style="margin-top:6px">Verify OTP</button>
    </div>
    <p class="muted" data-el="aadhaarStatus"></p>
  `;
  $('regMembers').appendChild(card);

  const q = (sel) => card.querySelector(sel);
  q('[data-del]').addEventListener('click', () => {
    regState.members = regState.members.filter((x) => x.id !== mid);
    card.remove();
    refreshRegisterEnabled();
  });
  q('[data-f="same"]').addEventListener('change', (e) => {
    m.sameAsPrimary = e.target.checked;
    q('[data-el="addrBox"]').classList.toggle('hidden', e.target.checked);
  });
  q('[data-f="photo"]').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try { m.photo = await compressPhoto(f); q('[data-el="photoPrev"]').src = m.photo; q('[data-el="photoPrev"]').style.display = 'block'; }
    catch (_) { Notify.toast('Photo', 'Could not read image', 'error'); }
  });
  q('[data-act="geo"]').addEventListener('click', async () => {
    const addr = q('[data-f="address"]').value.trim();
    if (!addr) return;
    q('[data-el="addrGeo"]').textContent = 'Locating…';
    try {
      const res = await geocode(addr);
      m.addressGeo = res ? { address: res.address, lat: res.lat, lng: res.lng } : { address: addr, lat: null, lng: null };
      q('[data-el="addrGeo"]').textContent = res ? `Located: ${res.address}` : 'Saved address (no map pin).';
    } catch (err) {
      m.addressGeo = { address: addr, lat: null, lng: null };
      q('[data-el="addrGeo"]').textContent = 'Map unavailable: ' + (err.message || 'could not locate');
    }
  });
  q('[data-act="sendOtp"]').addEventListener('click', async () => {
    const num = q('[data-f="aadhaar"]').value.trim();
    if (!isValidAadhaarFormat(num)) return Notify.toast('Aadhaar', 'Enter a valid 12-digit number', 'error');
    q('[data-el="aadhaarStatus"]').textContent = 'Sending OTP…';
    const res = await Aadhaar.sendOtp(num);
    if (!res.ok) { q('[data-el="aadhaarStatus"]').textContent = res.error; return; }
    m.aadhaarTxnId = res.txnId;
    q('[data-el="otpBox"]').classList.remove('hidden');
    q('[data-el="aadhaarStatus"]').textContent = res.devHint ? `OTP sent (demo OTP: ${res.devHint})` : 'OTP sent.';
  });
  q('[data-act="verifyOtp"]').addEventListener('click', async () => {
    const res = await Aadhaar.verifyOtp(m.aadhaarTxnId, q('[data-f="otp"]').value.trim());
    if (!res.ok) { q('[data-el="aadhaarStatus"]').textContent = res.error; return; }
    m.aadhaarVerified = true;
    q('[data-el="aadhaarStatus"]').textContent = '✓ Aadhaar verified';
    q('[data-el="otpBox"]').classList.add('hidden');
    refreshRegisterEnabled();
  });
  q('[data-f="forename"]').addEventListener('input', () => { m._fore = q('[data-f="forename"]').value.trim(); });

  refreshRegisterEnabled();
}

/** Register is enabled only when self + every member has verified Aadhaar. */
function refreshRegisterEnabled() {
  const allVerified = regState.self.aadhaarVerified && regState.members.every((m) => m.aadhaarVerified);
  $('regSubmit').disabled = !allVerified;
  $('regSubmitHint').textContent = allVerified
    ? 'All verified — you can register.'
    : 'Verify Aadhaar for everyone to enable registration.';
}

$('regSubmit').addEventListener('click', async () => {
  const forename = $('regForename').value.trim();
  const surname = $('regSurname').value.trim();
  const phone = $('regPhone').value.trim();
  if (!forename || !surname) return Notify.toast('Registration', 'Enter your name', 'error');
  if (!phone) return Notify.toast('Registration', 'Enter your mobile number', 'error');
  if (!regState.self.addressGeo) return Notify.toast('Registration', 'Locate your address', 'error');
  if (!regState.self.aadhaarVerified) return Notify.toast('Registration', 'Verify your Aadhaar', 'error');

  // no phone clash
  const clients = await Data.getAll(COLLECTION.CLIENTS);
  if (clients.some((c) => (c.phone || '').replace(/\s/g, '') === phone.replace(/\s/g, ''))) {
    return Notify.toast('Registration', 'A client with this number already exists.', 'error');
  }

  // assemble members from DOM + regState
  const members = regState.members.map((m) => {
    const card = document.querySelector(`[data-mid="${m.id}"]`);
    const g = (f) => card.querySelector(`[data-f="${f}"]`).value.trim();
    return {
      forename: g('forename'), surname: g('surname'), sex: g('sex'), dob: g('dob'),
      relationship: g('relationship'), photo: m.photo,
      address: m.sameAsPrimary ? regState.self.addressGeo : (m.addressGeo || regState.self.addressGeo),
      aadhaar: { number: g('aadhaar'), verified: true }
    };
  });

  const client = createClient({
    forename, surname, phone,
    sex: $('regSex').value, dob: $('regDob').value,
    photo: regState.self.photo,
    address: regState.self.addressGeo,
    aadhaar: { number: $('regAadhaar').value.trim(), verified: true },
    members
  });
  client.accessCode = String(Math.floor(100000 + Math.random() * 900000));

  const btn = $('regSubmit');
  btn.disabled = true; btn.textContent = 'Registering…';
  try {
    await Data.write(COLLECTION.CLIENTS, client);
    alert(`Registration complete!\n\nYour login:\nPhone: ${phone}\nAccess code: ${client.accessCode}\n\nPlease keep this code safe.`);
    Notify.toast('Registered', `You can sign in now · access code ${client.accessCode}`, 'success');
    showLogin();
  } catch (e) {
    Notify.toast('Registration failed', e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Register';
  }
});

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
  const prev = sel.value;
  if (state.services.length) {
    // driven by the admin Services master (active services only)
    sel.innerHTML = state.services
      .map((s) => `<option value="${s.key}">${s.name} — ₹${s.cost}</option>`).join('');
  } else {
    // fallback before the master loads / offline
    sel.innerHTML = Object.values(Speciality)
      .map((s) => `<option value="${s}">${labelize(s)}</option>`).join('');
  }
  if (prev) sel.value = prev;
  prefillCostFromService();
}

/** Pre-fill the (editable) price field from the selected service's cost. */
function prefillCostFromService() {
  const svc = state.services.find((s) => s.key === $('speciality').value);
  if (svc) $('price').value = svc.cost;
}

document.getElementById('speciality').addEventListener('change', prefillCostFromService);

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

  const svc = state.services.find((s) => s.key === $('speciality').value);
  const booking = createBooking({
    clientId: state.client.id,
    speciality: $('speciality').value,
    serviceId: svc ? svc.id : null,
    commissionPct: svc ? svc.commissionPct : null, // snapshot commission at booking time
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

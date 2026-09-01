/* maps.js — Google Maps Platform integration.
 *
 * Wraps the pieces the spec asks for onto their web equivalents:
 *   - Maps JavaScript API  -> map rendering + live caregiver marker
 *   - Geocoding API        -> address <-> lat/lng (client picks a location)
 *   - Directions API       -> route polyline + distance/ETA (Routes equivalent)
 *   - device Geolocation   -> caregiver location sharing (Navigation SDK role)
 *
 * The Maps JS SDK is loaded lazily so pages that don't need a map stay light.
 * If no API key is configured, helpers degrade gracefully (return null) so the
 * rest of the app still works.
 */
import { CONFIG } from './config.js';

let _loaderPromise = null;

/** Reason the maps SDK is unavailable, if it failed. Null when OK/not-yet-tried. */
export let mapsLoadError = null;

/**
 * Load the Google Maps JS SDK once. Resolves to window.google.maps, or null if
 * no key is configured. Rejects (and sets mapsLoadError) if the SDK fails to
 * initialise — e.g. the "Maps JavaScript API" isn't enabled for the key, or a
 * referrer/billing problem. Google reports these in-browser via the global
 * gm_authFailure callback (not via a script onerror), so we hook that.
 */
export function loadMaps() {
  if (window.google && window.google.maps) return Promise.resolve(window.google.maps);
  if (_loaderPromise) return _loaderPromise;
  if (!CONFIG.googleMapsApiKey || CONFIG.googleMapsApiKey.startsWith('YOUR_')) {
    console.warn('maps.js: no Google Maps API key set — map features disabled.');
    return Promise.resolve(null);
  }
  _loaderPromise = new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };

    const cb = '__hcMapsReady';
    window[cb] = () => done(resolve, window.google.maps);

    // Google calls this global when the key is rejected (API not enabled,
    // referrer/billing/quota). It's the only signal for auth failures.
    window.gm_authFailure = () => {
      mapsLoadError = 'Google Maps rejected the API key. In Google Cloud, enable '
        + 'the "Maps JavaScript API" for this key and check billing/referrer restrictions.';
      console.error('maps.js: ' + mapsLoadError);
      done(reject, new Error(mapsLoadError));
    };

    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(CONFIG.googleMapsApiKey)}` +
      `&libraries=places,geometry&loading=async&callback=${cb}`;
    s.async = true;
    s.defer = true;
    s.onerror = () => {
      mapsLoadError = 'Network error loading Google Maps SDK.';
      done(reject, new Error(mapsLoadError));
    };
    document.head.appendChild(s);

    // Safety net: if neither callback fires (e.g. blocked silently), fail after 12s.
    setTimeout(() => {
      if (!settled) {
        mapsLoadError = 'Google Maps SDK did not initialise (timeout). '
          + 'Likely the Maps JavaScript API is not enabled for this key.';
        console.error('maps.js: ' + mapsLoadError);
        done(reject, new Error(mapsLoadError));
      }
    }, 12000);
  });
  return _loaderPromise;
}

/**
 * Geocode a free-text address to { address, lat, lng }.
 * Returns null if the address can't be found. Throws if the Maps SDK itself
 * failed to load (so the UI can show the real reason, not "address not found").
 */
export async function geocode(address) {
  const maps = await loadMaps(); // may throw with mapsLoadError
  if (!maps) return null;        // no key configured
  const geocoder = new maps.Geocoder();
  return new Promise((resolve) => {
    geocoder.geocode({ address }, (results, status) => {
      if (status === 'OK' && results[0]) {
        const loc = results[0].geometry.location;
        resolve({ address: results[0].formatted_address, lat: loc.lat(), lng: loc.lng() });
      } else {
        resolve(null);
      }
    });
  });
}

/** Reverse geocode { lat, lng } to a readable address (or null). */
export async function reverseGeocode(lat, lng) {
  const maps = await loadMaps();
  if (!maps) return null;
  const geocoder = new maps.Geocoder();
  return new Promise((resolve) => {
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      resolve(status === 'OK' && results[0] ? results[0].formatted_address : null);
    });
  });
}

/** Read this device's current position via the browser Geolocation API. */
export function currentPosition(opts = { enableHighAccuracy: true, timeout: 10000 }) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation unavailable'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) => reject(err),
      opts
    );
  });
}

/** Watch position continuously (caregiver location sharing). Returns a stop fn. */
export function watchPosition(onUpdate, onError) {
  if (!navigator.geolocation) { onError && onError(new Error('Geolocation unavailable')); return () => {}; }
  const id = navigator.geolocation.watchPosition(
    (p) => onUpdate({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
    (err) => onError && onError(err),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
  );
  return () => navigator.geolocation.clearWatch(id);
}

/**
 * Live map controller for the client's "track my caregiver" view.
 * Renders the client destination + a caregiver marker you can move as pings
 * arrive, and (optionally) draws the driving route with distance/ETA.
 */
export async function createLiveMap(container, destination) {
  let maps;
  try {
    maps = await loadMaps();
  } catch (e) {
    // Maps SDK failed to load (API not enabled / billing / referrer). Show why
    // instead of letting the rejection break the caller's render.
    container.textContent = (e && e.message) ? e.message : 'Map failed to load.';
    return null;
  }
  if (!maps) { container.textContent = 'Map unavailable (set a Google Maps API key in config.js).'; return null; }

  const map = new maps.Map(container, { center: destination, zoom: 14, disableDefaultUI: false });
  const destMarker = new maps.Marker({ position: destination, map, label: 'Home', title: 'Your location' });
  const cgMarker = new maps.Marker({
    position: destination, map, title: 'Caregiver',
    icon: { path: maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#1a73e8', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 }
  });
  const directions = new maps.DirectionsService();
  const renderer = new maps.DirectionsRenderer({ map, suppressMarkers: true, preserveViewport: true });

  return {
    map,
    /** Move the caregiver marker and refresh the route + ETA. */
    async update(lat, lng) {
      const pos = { lat, lng };
      cgMarker.setPosition(pos);
      const bounds = new maps.LatLngBounds();
      bounds.extend(pos); bounds.extend(destination);
      map.fitBounds(bounds);
      return new Promise((resolve) => {
        directions.route(
          { origin: pos, destination, travelMode: maps.TravelMode.DRIVING },
          (res, status) => {
            if (status === 'OK') {
              renderer.setDirections(res);
              const leg = res.routes[0].legs[0];
              resolve({ distanceText: leg.distance.text, etaText: leg.duration.text });
            } else {
              resolve(null);
            }
          }
        );
      });
    }
  };
}

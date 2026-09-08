/*
 * firestore-sync.js — Firestore data layer for the License Generator.
 *
 * Design:
 *   - Firestore is the source of truth for two collections:
 *       apps    (the app registry)
 *       history (generated license entries)
 *   - localStorage is kept as an offline mirror/cache so the UI can render
 *     instantly and keep working with no connection.
 *   - On first init we push any local-only data up to Firestore ONCE
 *     (initial migration), then Firestore drives the UI via real-time
 *     listeners. After migration, remote is authoritative.
 *
 * This is a classic (non-module) script. It waits for window.__fbReady
 * (set up by firebase-config.js) before touching Firestore, and degrades
 * gracefully to localStorage-only if Firebase never becomes available.
 *
 * Public API (window.LicenseSync):
 *   init(callbacks)                       -> Promise<void>
 *   getApps()                             -> Array           (from cache, sync)
 *   saveApps(appsArray)                   -> Promise<void>   (writes cloud+cache)
 *   getHistory()                          -> Array           (from cache, sync)
 *   addHistoryEntry(entry)                -> Promise<void>
 *   deleteHistoryEntry(id)                -> Promise<void>
 *   clearAppHistory(appName)              -> Promise<void>
 *   status()                              -> 'online'|'offline'|'syncing'|'local-only'
 *
 * callbacks: { onApps(apps), onHistory(history), onStatus(status) }
 */
(function () {
  'use strict';

  var APPS_KEY = 'license_gen_apps';
  var HISTORY_KEY = 'license_gen_history';
  var MIGRATION_FLAG = 'license_gen_fb_migrated';
  var MAX_HISTORY = 500;

  var APPS_COLLECTION = 'apps';
  var HISTORY_COLLECTION = 'history';

  var fb = null;              // window.__fb surface once ready
  var ready = false;          // Firestore usable (authenticated + connected)
  var _status = 'local-only';
  var _user = null;           // current Firebase auth user (or null)
  var _listenersAttached = false;
  var cb = { onApps: null, onHistory: null, onStatus: null, onAuth: null };

  // In-memory caches, always mirrored to localStorage.
  var appsCache = [];
  var historyCache = [];

  // ---- localStorage helpers ------------------------------------------------

  function _lsGet(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed;
    } catch (e) {
      return fallback;
    }
  }

  function _lsSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* quota / unavailable — ignore */ }
  }

  // ---- status --------------------------------------------------------------

  function _setStatus(s) {
    _status = s;
    if (typeof cb.onStatus === 'function') {
      try { cb.onStatus(s); } catch (e) {}
    }
  }

  function status() { return _status; }

  // ---- id helpers ----------------------------------------------------------

  // Deterministic doc id for an app so the same app name maps to one document.
  function _appDocId(name) {
    return 'app_' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  // Stable id for a history entry. Reuse an existing id if present, otherwise
  // derive one from its content + timestamp so the same local entry maps to
  // the same Firestore document during migration.
  function _historyId(entry) {
    if (entry && entry.id) return entry.id;
    var base = (entry.appName || '') + '|' + (entry.userName || '') + '|' + (entry.timestamp || '');
    var h = 0;
    for (var i = 0; i < base.length; i++) {
      h = ((h << 5) - h + base.charCodeAt(i)) | 0;
    }
    return 'h_' + (entry.timestamp ? entry.timestamp.replace(/[^0-9]/g, '') : Date.now()) + '_' + Math.abs(h).toString(36);
  }

  // ---- normalization -------------------------------------------------------

  function _normalizeHistoryEntry(e) {
    var entry = {
      id: e.id || _historyId(e),
      appName: e.appName || '',
      userName: e.userName || '',
      licenseKey: e.licenseKey || '',
      timestamp: e.timestamp || new Date().toISOString(),
      licenseType: e.licenseType || 'perpetual',
      validFrom: (e.validFrom === undefined) ? null : e.validFrom,
      validTo: (e.validTo === undefined) ? null : e.validTo
    };
    return entry;
  }

  function _sortHistory(arr) {
    // newest first by timestamp
    arr.sort(function (a, b) {
      return a.timestamp < b.timestamp ? 1 : (a.timestamp > b.timestamp ? -1 : 0);
    });
    return arr;
  }

  // ---- cache emit ----------------------------------------------------------

  function _emitApps() {
    _lsSet(APPS_KEY, appsCache);
    if (typeof cb.onApps === 'function') {
      try { cb.onApps(appsCache.slice()); } catch (e) {}
    }
  }

  function _emitHistory() {
    _lsSet(HISTORY_KEY, historyCache);
    if (typeof cb.onHistory === 'function') {
      try { cb.onHistory(historyCache.slice()); } catch (e) {}
    }
  }

  // ---- public getters (sync, from cache) -----------------------------------

  function getApps() { return appsCache.slice(); }
  function getHistory() { return historyCache.slice(); }

  // ---- writes --------------------------------------------------------------

  // Replace the entire app registry. Writes cloud (batched) + cache.
  function saveApps(apps) {
    appsCache = apps.slice();
    _emitApps();
    if (!ready) return Promise.resolve();

    _setStatus('syncing');
    try {
      var batch = fb.writeBatch(fb.db);
      var col = fb.collection(fb.db, APPS_COLLECTION);
      // Upsert each app under a deterministic id.
      var seenIds = {};
      appsCache.forEach(function (a, idx) {
        var id = _appDocId(a.name);
        seenIds[id] = true;
        batch.set(fb.doc(col, id), {
          name: a.name,
          secret: a.secret,
          restricted: a.restricted === true,
          order: idx
        });
      });
      return batch.commit().then(function () {
        _setStatus('online');
      }).catch(function (err) {
        console.warn('[sync] saveApps failed, cached locally:', err && err.code);
        _setStatus('offline');
      });
    } catch (e) {
      _setStatus('offline');
      return Promise.resolve();
    }
  }

  function addHistoryEntry(rawEntry) {
    var entry = _normalizeHistoryEntry(rawEntry);
    // Update cache with cap enforcement.
    historyCache.push(entry);
    if (historyCache.length > MAX_HISTORY) {
      _sortHistory(historyCache); // newest first
      var removed = historyCache.splice(MAX_HISTORY); // drop oldest overflow
      // Best-effort delete of evicted docs from cloud.
      if (ready && removed.length) {
        removed.forEach(function (r) {
          try { fb.deleteDoc(fb.doc(fb.collection(fb.db, HISTORY_COLLECTION), r.id)); } catch (e) {}
        });
      }
    }
    _sortHistory(historyCache);
    _emitHistory();

    if (!ready) return Promise.resolve(entry);

    _setStatus('syncing');
    try {
      var ref = fb.doc(fb.collection(fb.db, HISTORY_COLLECTION), entry.id);
      return fb.setDoc(ref, {
        appName: entry.appName,
        userName: entry.userName,
        licenseKey: entry.licenseKey,
        timestamp: entry.timestamp,
        licenseType: entry.licenseType,
        validFrom: entry.validFrom,
        validTo: entry.validTo
      }).then(function () {
        _setStatus('online');
        return entry;
      }).catch(function (err) {
        console.warn('[sync] addHistoryEntry failed, cached locally:', err && err.code);
        _setStatus('offline');
        return entry;
      });
    } catch (e) {
      _setStatus('offline');
      return Promise.resolve(entry);
    }
  }

  function deleteHistoryEntry(id) {
    historyCache = historyCache.filter(function (e) { return e.id !== id; });
    _emitHistory();
    if (!ready) return Promise.resolve();
    _setStatus('syncing');
    try {
      return fb.deleteDoc(fb.doc(fb.collection(fb.db, HISTORY_COLLECTION), id))
        .then(function () { _setStatus('online'); })
        .catch(function (err) {
          console.warn('[sync] deleteHistoryEntry failed:', err && err.code);
          _setStatus('offline');
        });
    } catch (e) {
      _setStatus('offline');
      return Promise.resolve();
    }
  }

  function clearAppHistory(appName) {
    var toDelete = historyCache.filter(function (e) { return e.appName === appName; });
    historyCache = historyCache.filter(function (e) { return e.appName !== appName; });
    _emitHistory();
    if (!ready) return Promise.resolve();
    _setStatus('syncing');
    try {
      var batch = fb.writeBatch(fb.db);
      var col = fb.collection(fb.db, HISTORY_COLLECTION);
      toDelete.forEach(function (e) { batch.delete(fb.doc(col, e.id)); });
      return batch.commit()
        .then(function () { _setStatus('online'); })
        .catch(function (err) {
          console.warn('[sync] clearAppHistory failed:', err && err.code);
          _setStatus('offline');
        });
    } catch (e) {
      _setStatus('offline');
      return Promise.resolve();
    }
  }

  // ---- initial migration (local -> cloud, once) ----------------------------

  function _migrateLocalToCloud() {
    // Only run once per browser. After this, cloud is authoritative.
    var alreadyMigrated = _lsGet(MIGRATION_FLAG, false) === true;

    var localApps = _lsGet(APPS_KEY, []) || [];
    var localHistory = (_lsGet(HISTORY_KEY, []) || []).map(_normalizeHistoryEntry);

    return _fetchCloudApps().then(function (cloudApps) {
      return _fetchCloudHistory().then(function (cloudHistory) {
        var promises = [];

        // Apps: if cloud is empty, seed it from local. Otherwise leave cloud as-is.
        if (cloudApps.length === 0 && localApps.length > 0) {
          promises.push(saveApps(localApps));
        }

        // History: push any local entries whose id is not already in the cloud.
        if (localHistory.length > 0) {
          var cloudIds = {};
          cloudHistory.forEach(function (h) { cloudIds[h.id] = true; });
          var missing = localHistory.filter(function (h) { return !cloudIds[h.id]; });
          if (missing.length && ready) {
            var batch = fb.writeBatch(fb.db);
            var col = fb.collection(fb.db, HISTORY_COLLECTION);
            missing.forEach(function (h) {
              batch.set(fb.doc(col, h.id), {
                appName: h.appName,
                userName: h.userName,
                licenseKey: h.licenseKey,
                timestamp: h.timestamp,
                licenseType: h.licenseType,
                validFrom: h.validFrom,
                validTo: h.validTo
              });
            });
            promises.push(batch.commit().catch(function (err) {
              console.warn('[sync] history migration failed:', err && err.code);
            }));
          }
        }

        return Promise.all(promises).then(function () {
          _lsSet(MIGRATION_FLAG, true);
        });
      });
    }).catch(function (err) {
      console.warn('[sync] migration skipped:', err && err.code);
    });
  }

  function _fetchCloudApps() {
    if (!ready) return Promise.resolve([]);
    return fb.getDocs(fb.collection(fb.db, APPS_COLLECTION)).then(function (snap) {
      var arr = [];
      snap.forEach(function (d) {
        var data = d.data();
        arr.push({
          name: data.name,
          secret: data.secret,
          restricted: data.restricted === true,
          order: (typeof data.order === 'number') ? data.order : 999
        });
      });
      arr.sort(function (a, b) { return a.order - b.order; });
      return arr;
    });
  }

  function _fetchCloudHistory() {
    if (!ready) return Promise.resolve([]);
    return fb.getDocs(fb.collection(fb.db, HISTORY_COLLECTION)).then(function (snap) {
      var arr = [];
      snap.forEach(function (d) {
        var data = d.data();
        data.id = d.id;
        arr.push(_normalizeHistoryEntry(data));
      });
      return arr;
    });
  }

  // ---- real-time listeners -------------------------------------------------

  function _attachListeners() {
    if (!ready) return;

    fb.onSnapshot(fb.collection(fb.db, APPS_COLLECTION), function (snap) {
      var arr = [];
      snap.forEach(function (d) {
        var data = d.data();
        arr.push({
          name: data.name,
          secret: data.secret,
          restricted: data.restricted === true,
          order: (typeof data.order === 'number') ? data.order : 999
        });
      });
      arr.sort(function (a, b) { return a.order - b.order; });
      // Strip helper 'order' before handing to the app (it doesn't expect it,
      // but it's harmless; keep name/secret/restricted shape).
      appsCache = arr.map(function (a) {
        var out = { name: a.name, secret: a.secret };
        if (a.restricted) out.restricted = true;
        return out;
      });
      _emitApps();
      if (_status !== 'syncing') _setStatus('online');
    }, function (err) {
      console.warn('[sync] apps listener error:', err && err.code);
      _setStatus('offline');
    });

    fb.onSnapshot(fb.collection(fb.db, HISTORY_COLLECTION), function (snap) {
      var arr = [];
      snap.forEach(function (d) {
        var data = d.data();
        data.id = d.id;
        arr.push(_normalizeHistoryEntry(data));
      });
      _sortHistory(arr);
      historyCache = arr;
      _emitHistory();
      if (_status !== 'syncing') _setStatus('online');
    }, function (err) {
      console.warn('[sync] history listener error:', err && err.code);
      _setStatus('offline');
    });
  }

  // ---- init ----------------------------------------------------------------

  function init(callbacks) {
    callbacks = callbacks || {};
    cb.onApps = callbacks.onApps || null;
    cb.onHistory = callbacks.onHistory || null;
    cb.onStatus = callbacks.onStatus || null;
    cb.onAuth = callbacks.onAuth || null;

    // Seed caches from localStorage immediately so the UI has data at once.
    appsCache = _lsGet(APPS_KEY, []) || [];
    historyCache = _sortHistory((_lsGet(HISTORY_KEY, []) || []).map(_normalizeHistoryEntry));
    _emitApps();
    _emitHistory();
    _setStatus('local-only');

    _setStatus('syncing');
    return _awaitFbReady(3000).then(function (readyPromise) {
      if (!readyPromise || typeof readyPromise.then !== 'function') {
        // Firebase config never loaded — stay in local-only mode.
        _setStatus('local-only');
        return null;
      }
      return readyPromise;
    }).then(function (readyPromise) {
      if (!readyPromise) return; // local-only
      return readyPromise.then(function (surface) {
        fb = surface;
        // Gate Firestore access on authentication. onAuthStateChanged fires
        // immediately with the restored user (or null) and again on sign-in/out.
        if (typeof fb.onAuthStateChanged === 'function') {
          fb.onAuthStateChanged(function (user) {
            _user = user || null;
            if (typeof cb.onAuth === 'function') {
              try { cb.onAuth(_user); } catch (e) {}
            }
            if (_user) {
              // Authenticated — connect Firestore (migrate + listeners once).
              _connectAuthed();
            } else {
              // Signed out — drop to local-only; keep cache for offline display.
              ready = false;
              _setStatus('local-only');
            }
          });
        } else {
          // No auth surface available; connect directly (legacy behavior).
          _connectAuthed();
        }
      });
    });
  }

  // Sign in with email/password. Returns a Promise. On success, the auth state
  // listener above connects Firestore automatically.
  function signIn(email, password) {
    if (!fb || typeof fb.signInWithEmail !== 'function') {
      return Promise.reject(new Error('Firebase auth not available'));
    }
    return fb.signInWithEmail(email, password);
  }

  function signOutUser() {
    if (!fb || typeof fb.signOutUser !== 'function') return Promise.resolve();
    return fb.signOutUser();
  }

  function currentUser() { return _user; }

  // firebase-config.js is an ES module and therefore deferred: it runs AFTER
  // these classic scripts. So window.__fbReady may not exist yet when init()
  // is called. Poll briefly for it before giving up.
  function _awaitFbReady(timeoutMs) {
    return new Promise(function (resolve) {
      if (window.__fbReady) return resolve(window.__fbReady);
      var waited = 0;
      var step = 50;
      var timer = setInterval(function () {
        if (window.__fbReady) {
          clearInterval(timer);
          resolve(window.__fbReady);
        } else if ((waited += step) >= timeoutMs) {
          clearInterval(timer);
          resolve(null);
        }
      }, step);
    });
  }

  // Called once the user is authenticated. Runs the one-time migration and
  // attaches real-time listeners (guarded so re-auth doesn't double-attach).
  function _connectAuthed() {
    ready = true;
    _setStatus('syncing');
    return _migrateLocalToCloud().then(function () {
      if (!_listenersAttached) {
        _attachListeners();
        _listenersAttached = true;
      }
      _setStatus('online');
    }).catch(function (err) {
      console.warn('[sync] Firestore connect failed:', err && (err.code || err.message));
      _setStatus('offline');
    });
  }

  // Track browser connectivity for a coarse status hint.
  window.addEventListener('online', function () {
    if (ready) _setStatus('online');
  });
  window.addEventListener('offline', function () {
    _setStatus('offline');
  });

  window.LicenseSync = {
    init: init,
    getApps: getApps,
    saveApps: saveApps,
    getHistory: getHistory,
    addHistoryEntry: addHistoryEntry,
    deleteHistoryEntry: deleteHistoryEntry,
    clearAppHistory: clearAppHistory,
    status: status,
    signIn: signIn,
    signOut: signOutUser,
    currentUser: currentUser
  };
})();

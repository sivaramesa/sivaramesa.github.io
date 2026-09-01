/* dom.js — tiny UI helpers shared by all three PWAs.
 *
 * guardedClick / guardedDelegate prevent the "double-click fires the action
 * twice" class of bug on async buttons (state transitions, payments, etc.):
 * while the handler runs, the button is disabled and re-entry is ignored, then
 * it is re-enabled. The handler should still re-check state server-side/in the
 * record, since another device could change things concurrently.
 */

/**
 * Wire a click handler on a single element (by id or element) that cannot
 * double-fire. Returns nothing.
 * @param {string|HTMLElement} target element id or the element itself
 * @param {(ev:Event)=>Promise<any>|any} handler async or sync handler
 */
export function guardedClick(target, handler) {
  const btn = typeof target === 'string' ? document.getElementById(target) : target;
  if (!btn) return;
  let busy = false;
  btn.addEventListener('click', async (ev) => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    btn.classList.add('is-busy');
    try { await handler(ev); }
    finally { busy = false; btn.disabled = false; btn.classList.remove('is-busy'); }
  });
}

/**
 * Guard a single dynamically-rendered button (e.g. one row's Accept button).
 * Call this on the button element after rendering. Safe to call once per node.
 * @param {HTMLElement} btn
 * @param {()=>Promise<any>|any} handler
 */
export function guardOnce(btn, handler) {
  if (!btn || btn._guarded) return;
  btn._guarded = true;
  let busy = false;
  btn.addEventListener('click', async (ev) => {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    btn.classList.add('is-busy');
    try { await handler(ev); }
    finally { busy = false; btn.disabled = false; btn.classList.remove('is-busy'); }
  });
}

/* theme.js — shared theming for all three HomeCare PWAs.
 *
 * Two axes, persisted in localStorage and applied to <html>:
 *   data-mode  = 'dark' | 'light'   (default: dark)
 *   data-theme = one of THEMES      (default: 'blue')
 *
 * Renders a compact control into the banner: a mode toggle (moon/sun) button
 * that opens a popover with a light/dark switch + five accent swatches.
 * Colours come from CSS variables so text stays legible in both modes.
 */

export const THEMES = [
  { key: 'blue',    label: 'Blue',    color: '#2a7fff' },
  { key: 'teal',    label: 'Teal',    color: '#14a3a3' },
  { key: 'violet',  label: 'Violet',  color: '#7c5cff' },
  { key: 'emerald', label: 'Emerald', color: '#16a34a' },
  { key: 'rose',    label: 'Rose',    color: '#e0457b' }
];

const MODE_KEY = 'hc_mode';
const THEME_KEY = 'hc_theme';
const DEFAULT_MODE = 'dark';
const DEFAULT_THEME = 'blue';

export const Theme = {
  mode() { return localStorage.getItem(MODE_KEY) || DEFAULT_MODE; },
  theme() {
    const t = localStorage.getItem(THEME_KEY) || DEFAULT_THEME;
    return THEMES.some((x) => x.key === t) ? t : DEFAULT_THEME;
  },

  /** Apply the saved (or default) mode + theme to <html>. Call early. */
  apply() {
    const el = document.documentElement;
    el.setAttribute('data-mode', this.mode());
    el.setAttribute('data-theme', this.theme());
  },

  setMode(mode) {
    localStorage.setItem(MODE_KEY, mode === 'light' ? 'light' : 'dark');
    this.apply();
    this._refreshControl();
  },
  toggleMode() { this.setMode(this.mode() === 'dark' ? 'light' : 'dark'); },

  setTheme(key) {
    if (!THEMES.some((x) => x.key === key)) return;
    localStorage.setItem(THEME_KEY, key);
    this.apply();
    this._refreshControl();
  },

  /**
   * Mount the banner control. Pass the topbar element (or it finds .topbar).
   * Inserts a theme button; clicking it toggles a popover.
   */
  mountControl(topbar) {
    this.apply();
    const bar = topbar || document.querySelector('.topbar');
    if (!bar || bar.querySelector('.theme-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'theme-btn';
    btn.type = 'button';
    btn.title = 'Theme';
    btn.setAttribute('aria-label', 'Theme settings');
    this._btn = btn;

    // place the button just before the sync dot if present, else append
    const dot = bar.querySelector('#syncDot');
    if (dot) bar.insertBefore(btn, dot); else bar.appendChild(btn);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._togglePop();
    });
    document.addEventListener('click', () => this._closePop());
    this._refreshControl();
  },

  _refreshControl() {
    if (this._btn) this._btn.textContent = this.mode() === 'dark' ? '🌙' : '☀️';
    if (this._pop && !this._pop.classList.contains('hidden')) this._renderPop();
  },

  _togglePop() {
    if (this._pop && !this._pop.classList.contains('hidden')) return this._closePop();
    this._openPop();
  },

  _openPop() {
    if (!this._pop) {
      this._pop = document.createElement('div');
      this._pop.className = 'theme-pop';
      this._pop.addEventListener('click', (e) => e.stopPropagation());
      document.body.appendChild(this._pop);
    }
    this._pop.classList.remove('hidden');
    this._renderPop();
  },

  _closePop() { if (this._pop) this._pop.classList.add('hidden'); },

  _renderPop() {
    const mode = this.mode();
    const active = this.theme();
    this._pop.innerHTML =
      `<div class="mode-row">
         <strong style="font-size:13px">Appearance</strong>
         <button class="mode-toggle" type="button">${mode === 'dark' ? '☀️ Light' : '🌙 Dark'}</button>
       </div>
       <div class="swatches">
         ${THEMES.map((t) =>
           `<span class="swatch ${t.key === active ? 'active' : ''}" data-theme-key="${t.key}"
                  title="${t.label}" style="background:${t.color}"></span>`).join('')}
       </div>`;
    this._pop.querySelector('.mode-toggle').addEventListener('click', () => this.toggleMode());
    this._pop.querySelectorAll('[data-theme-key]').forEach((sw) => {
      sw.addEventListener('click', () => this.setTheme(sw.dataset.themeKey));
    });
  }
};

// Apply immediately on import so there's no flash of the wrong theme.
try { Theme.apply(); } catch (_) {}

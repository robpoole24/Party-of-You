/**
 * JUST HELP — EMBEDDABLE WIDGET SCRIPT
 * 
 * Candidates add ONE line to their campaign website:
 *   <script src="https://partyofyou.org/widgets/just-help.js"></script>
 * 
 * Then put a container wherever they want the widget to appear:
 *   <div id="just-help-widget"></div>
 * 
 * The widget renders itself into that container automatically.
 * No other dependencies. No configuration required.
 * Works in any HTML page.
 * 
 * Optional config via data attributes on the container:
 *   <div id="just-help-widget"
 *        data-theme="light"
 *        data-title="Find Help in Milwaukee"
 *        data-default-location="53221">
 *   </div>
 */

(function () {
  'use strict';

  const JUST_HELP_MAP_URL = 'https://justhelp.up.railway.app/map';

  const SERVICES = [
    { id: 'food',              label: 'Food Pantries'        },
    { id: 'shelter',           label: 'Shelter'              },
    { id: 'domestic_violence', label: 'DV Safe Housing'      },
    { id: 'clothing',          label: 'Clothing'             },
    { id: 'rent_assistance',   label: 'Rent Assistance'      },
    { id: 'utility',           label: 'Utility Assistance'   },
    { id: 'healthcare',        label: 'Free Clinics'         },
    { id: 'dental',            label: 'Free/Low-Cost Dental' },
    { id: 'holiday_meals',     label: 'Holiday Meals'        },
    { id: 'holiday_gifts',     label: 'Holiday Gifts (Kids)' },
    { id: 'school_supplies',   label: 'School Supplies'      },
  ];

  // ── STYLES ──────────────────────────────────────────────────────
  const CSS = `
    .jh-w { max-width:520px; background:#0f172a; border:1px solid rgba(255,255,255,0.1); border-radius:12px; padding:22px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#e2e8f0; }
    .jh-w--light { background:#ffffff; border-color:#e2e8f0; color:#1e293b; }
    .jh-hdr { display:flex; gap:11px; align-items:flex-start; margin-bottom:18px; }
    .jh-ico { width:34px; height:34px; background:#dc2626; border-radius:7px; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:17px; }
    .jh-ttl { font-size:15px; font-weight:700; color:#f8fafc; line-height:1.2; }
    .jh-w--light .jh-ttl { color:#0f172a; }
    .jh-sub { font-size:11px; color:#64748b; margin-top:3px; line-height:1.4; }
    .jh-search { display:flex; gap:8px; margin-bottom:14px; }
    .jh-inp { flex:1; height:38px; background:#1e293b; border:1px solid rgba(255,255,255,0.12); border-radius:7px; color:#f1f5f9; font-size:14px; padding:0 12px; outline:none; font-family:inherit; }
    .jh-w--light .jh-inp { background:#f8fafc; border-color:#cbd5e1; color:#1e293b; }
    .jh-inp::placeholder { color:#475569; }
    .jh-inp:focus { border-color:#dc2626; }
    .jh-err { font-size:11px; color:#f87171; margin:-8px 0 10px; display:none; }
    .jh-err.show { display:block; }
    .jh-clbl { font-size:10px; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; color:#64748b; margin-bottom:8px; }
    .jh-srow { display:flex; gap:10px; margin-bottom:10px; }
    .jh-lbtn { background:none; border:none; color:#94a3b8; font-size:11px; cursor:pointer; text-decoration:underline; padding:0; font-family:inherit; }
    .jh-lbtn:hover { color:#e2e8f0; }
    .jh-w--light .jh-lbtn:hover { color:#1e293b; }
    .jh-cbs { display:grid; grid-template-columns:1fr 1fr; gap:5px 14px; margin-bottom:18px; }
    .jh-cb { display:flex; align-items:center; gap:7px; cursor:pointer; padding:4px 0; user-select:none; }
    .jh-cb input { appearance:none; -webkit-appearance:none; width:15px; height:15px; border:1.5px solid #475569; border-radius:3px; background:#1e293b; flex-shrink:0; cursor:pointer; position:relative; transition:all 0.1s; }
    .jh-w--light .jh-cb input { background:#f1f5f9; }
    .jh-cb input:checked { background:#dc2626; border-color:#dc2626; }
    .jh-cb input:checked::after { content:''; position:absolute; left:4px; top:1px; width:4px; height:8px; border:2px solid white; border-top:none; border-left:none; transform:rotate(45deg); }
    .jh-cb span { font-size:12px; color:#cbd5e1; cursor:pointer; line-height:1.3; }
    .jh-w--light .jh-cb span { color:#475569; }
    .jh-btn { width:100%; height:42px; background:#dc2626; color:white; border:none; border-radius:7px; font-size:14px; font-weight:700; letter-spacing:0.02em; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:7px; transition:background 0.15s; font-family:inherit; }
    .jh-btn:hover { background:#b91c1c; }
    .jh-btn:active { transform:scale(0.99); }
    .jh-ftr { margin-top:12px; font-size:10px; color:#475569; text-align:center; line-height:1.5; }
    .jh-ftr a { color:#64748b; text-decoration:none; }
    .jh-ftr a:hover { color:#94a3b8; }
  `;

  // ── INJECT STYLES ────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('jh-embed-styles')) return;
    const style = document.createElement('style');
    style.id = 'jh-embed-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ── RENDER WIDGET ────────────────────────────────────────────────
  function render(container) {
    const theme = container.dataset.theme || 'dark';
    const title = container.dataset.title || 'Find Help in Your Community';
    const defaultLocation = container.dataset.defaultLocation || '';
    const uid = 'jh-' + Math.random().toString(36).slice(2, 7);

    const lightClass = theme === 'light' ? ' jh-w--light' : '';

    container.innerHTML = `
      <div class="jh-w${lightClass}" role="search" aria-label="Find community help resources">
        <div class="jh-hdr">
          <div class="jh-ico" aria-hidden="true">🤝</div>
          <div>
            <div class="jh-ttl">${escHtml(title)}</div>
            <div class="jh-sub">Free resources — food, shelter, healthcare, and more</div>
          </div>
        </div>

        <div class="jh-search">
          <input class="jh-inp" id="${uid}-loc" type="text"
            placeholder="Zip code or city name"
            aria-label="Your zip code or city"
            value="${escHtml(defaultLocation)}"
            maxlength="60" autocomplete="postal-code">
        </div>
        <div class="jh-err" id="${uid}-err">Please enter a zip code or city name.</div>

        <div class="jh-clbl">What do you need?</div>
        <div class="jh-srow">
          <button class="jh-lbtn" data-uid="${uid}" data-action="all" type="button">Select all</button>
          <button class="jh-lbtn" data-uid="${uid}" data-action="none" type="button">Clear all</button>
        </div>

        <div class="jh-cbs" id="${uid}-cbs">
          ${SERVICES.map(s => `
            <label class="jh-cb">
              <input type="checkbox" value="${s.id}" checked>
              <span>${escHtml(s.label)}</span>
            </label>
          `).join('')}
        </div>

        <button class="jh-btn" data-uid="${uid}" data-action="find" type="button">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          Find Help Near Me
        </button>

        <div class="jh-ftr">
          Powered by <a href="https://justhelp.up.railway.app" target="_blank" rel="noopener">Just Help</a>
          — free from <a href="https://altruisticapps.com" target="_blank" rel="noopener">Altruistic Apps</a>.
          No accounts. No data collected.
        </div>
      </div>
    `;

    // ── Event delegation ──
    container.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const cbs = container.querySelectorAll('.jh-cbs input[type="checkbox"]');

      if (action === 'all')  { cbs.forEach(cb => cb.checked = true); return; }
      if (action === 'none') { cbs.forEach(cb => cb.checked = false); return; }
      if (action === 'find') { doSearch(container, uid); return; }
    });

    container.querySelector(`#${uid}-loc`).addEventListener('keydown', e => {
      if (e.key === 'Enter') doSearch(container, uid);
    });

    container.querySelector(`#${uid}-loc`).addEventListener('input', () => {
      container.querySelector(`#${uid}-err`).classList.remove('show');
    });
  }

  // ── SEARCH ───────────────────────────────────────────────────────
  function doSearch(container, uid) {
    const locInput = container.querySelector(`#${uid}-loc`);
    const errEl = container.querySelector(`#${uid}-err`);
    const location = locInput.value.trim();

    if (!location) {
      errEl.classList.add('show');
      locInput.focus();
      return;
    }
    errEl.classList.remove('show');

    const selected = Array.from(
      container.querySelectorAll('.jh-cbs input[type="checkbox"]:checked')
    ).map(cb => cb.value);

    const params = new URLSearchParams();
    params.set('location', location);
    if (selected.length > 0 && selected.length < SERVICES.length) {
      params.set('services', selected.join(','));
    }

    window.open(`${JUST_HELP_MAP_URL}?${params.toString()}`, '_blank', 'noopener,noreferrer');
  }

  // ── UTILS ────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── INIT ─────────────────────────────────────────────────────────
  function init() {
    injectStyles();
    document.querySelectorAll('#just-help-widget, .just-help-widget').forEach(render);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

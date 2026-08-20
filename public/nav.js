/**
 * PARTY OF YOU — UNIFIED NAV COMPONENT
 * /public/nav.js
 *
 * Include on every page with ONE script tag at the top of <body>:
 *   <script src="/nav.js"></script>
 *
 * It injects:
 *   - A <style> block with nav CSS
 *   - The full <nav> element before the first element in <body>
 *   - A <link> to Google Fonts if not already present
 *
 * It auto-highlights the active page link based on window.location.pathname.
 * It requires no configuration — just include the script.
 *
 * To add/remove nav links, edit NAV_LINKS below.
 */

(function () {
  'use strict';

  // ── NAV LINKS ──────────────────────────────────────────────────
  // Add, remove, or reorder links here. One source of truth.
  const NAV_LINKS = [
    { href: '/platform.html',      label: 'Our Platform'   },
    { href: '/#how-it-works',      label: 'How It Works'   },
    { href: '/results.html',       label: 'Find Your Race' },
  ];

  const CTA = { href: '/apply.html', label: 'Run for Office →' };

  // ── DETECT ACTIVE PAGE ──────────────────────────────────────────
  function isActive(href) {
    const path = window.location.pathname;
    if (href === '/' && path === '/') return true;
    return href !== '/' && path.startsWith(href.replace('.html', ''));
  }

  // ── INJECT GOOGLE FONTS (only if not already loaded) ───────────
  function ensureFonts() {
    if (document.querySelector('link[href*="Barlow"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800;900&family=Barlow:wght@400;500;600&display=swap';
    document.head.appendChild(link);
  }

  // ── CSS ─────────────────────────────────────────────────────────
  const CSS = `
    :root {
      --poy-navy:   #1a2d5a;
      --poy-navy-d: #021434;
      --poy-red:    #c8102e;
      --poy-red-d:  #a00c24;
      --poy-sky:    #2b7fc1;
      --poy-white:  #ffffff;
      --poy-cond:   'Barlow Condensed', sans-serif;
      --poy-body:   'Barlow', sans-serif;
    }

    #poy-nav {
      position: fixed; top: 0; left: 0; right: 0; z-index: 1000;
      background: var(--poy-navy-d);
      border-bottom: 2px solid var(--poy-red);
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 32px; height: 64px;
      font-family: var(--poy-body);
    }

    #poy-nav .poy-nav-logo {
      display: flex; align-items: center; text-decoration: none;
      flex-shrink: 0;
    }
    #poy-nav .poy-nav-logo img {
      height: 52px; width: auto;
      display: block;
    }

    #poy-nav .poy-nav-links {
      display: flex; align-items: center; gap: 4px;
    }

    #poy-nav .poy-nav-links a {
      font-family: var(--poy-cond);
      font-size: 13px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.08em;
      color: rgba(255,255,255,0.65);
      text-decoration: none;
      padding: 6px 12px; border-radius: 4px;
      transition: color 0.15s, background 0.15s;
      white-space: nowrap;
    }
    #poy-nav .poy-nav-links a:hover {
      color: var(--poy-white);
      background: rgba(255,255,255,0.08);
    }
    #poy-nav .poy-nav-links a.poy-active {
      color: var(--poy-white);
      background: rgba(255,255,255,0.1);
    }
    #poy-nav .poy-nav-links a.poy-nav-cta {
      background: var(--poy-red);
      color: var(--poy-white) !important;
      padding: 7px 16px;
      margin-left: 6px;
      transition: background 0.15s;
    }
    #poy-nav .poy-nav-links a.poy-nav-cta:hover {
      background: var(--poy-red-d) !important;
    }

    /* Hamburger for mobile */
    #poy-nav .poy-hamburger {
      display: none;
      background: none; border: none;
      color: rgba(255,255,255,0.7);
      font-size: 22px; cursor: pointer;
      padding: 4px;
      line-height: 1;
    }

    /* Mobile drawer */
    #poy-nav-drawer {
      display: none;
      position: fixed; top: 56px; left: 0; right: 0; z-index: 999;
      background: var(--poy-navy-d);
      border-bottom: 2px solid var(--poy-red);
      padding: 12px 20px 16px;
      flex-direction: column; gap: 4px;
    }
    #poy-nav-drawer.open { display: flex; }
    #poy-nav-drawer a {
      font-family: var(--poy-cond);
      font-size: 16px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.08em;
      color: rgba(255,255,255,0.7);
      text-decoration: none;
      padding: 10px 12px; border-radius: 4px;
      transition: color 0.15s, background 0.15s;
    }
    #poy-nav-drawer a:hover,
    #poy-nav-drawer a.poy-active { color: var(--poy-white); background: rgba(255,255,255,0.08); }
    #poy-nav-drawer a.poy-nav-cta {
      background: var(--poy-red); color: var(--poy-white) !important;
      margin-top: 6px; text-align: center;
    }

    @media (max-width: 680px) {
      #poy-nav { padding: 0 16px; }
      #poy-nav .poy-nav-links { display: none; }
      #poy-nav .poy-hamburger { display: block; }

      /* Push page content below fixed nav */
      body { padding-top: 56px !important; }
    }
    @media (min-width: 681px) {
      /* Push page content below fixed nav on desktop too */
      body { padding-top: 0; }
    }
  `;

  // ── BUILD NAV HTML ───────────────────────────────────────────────
  function buildNav(isLoggedIn, candidateName) {
    const desktopLinks = NAV_LINKS.map(link =>
      `<a href="${link.href}"${isActive(link.href) ? ' class="poy-active"' : ''}>${link.label}</a>`
    ).join('');

    const drawerLinks = NAV_LINKS.map(link =>
      `<a href="${link.href}"${isActive(link.href) ? ' class="poy-active"' : ''}>${link.label}</a>`
    ).join('');

    // Show dashboard link instead of CTA if logged in
    const ctaHtml = isLoggedIn
      ? `<a href="/dashboard/" class="poy-nav-cta" style="display:flex;align-items:center;gap:6px">
           <span style="font-size:16px">⚡</span> My Dashboard
         </a>`
      : `<a href="${CTA.href}" class="poy-nav-cta">${CTA.label}</a>`;

    const drawerCtaHtml = isLoggedIn
      ? `<a href="/dashboard/" class="poy-nav-cta">⚡ My Dashboard</a>`
      : `<a href="${CTA.href}" class="poy-nav-cta">${CTA.label}</a>`;

    return `
      <nav id="poy-nav">
        <a href="/" class="poy-nav-logo">
          <img src="/images/partyofyoulogo.png" alt="Party of You — Build Campaigns, Engage Communities, Create Change">
        </a>
        <div class="poy-nav-links">
          ${desktopLinks}
          ${ctaHtml}
        </div>
        <button class="poy-hamburger" onclick="document.getElementById('poy-nav-drawer').classList.toggle('open')" aria-label="Toggle menu">☰</button>
      </nav>
      <div id="poy-nav-drawer">
        ${drawerLinks}
        ${drawerCtaHtml}
      </div>
    `;
  }

  // ── CHECK AUTH STATUS ────────────────────────────────────────────
  // Check for auth cookie synchronously — instant, no network call needed.
  // The cookie is HttpOnly so we can't read its value, but we can check
  // if it exists by hitting /api/auth/me. We do this after a short delay
  // to ensure the nav is fully rendered first.
  function checkAuthAndUpdate() {
    // Small delay to ensure DOM is settled
    setTimeout(() => {
      fetch('/api/auth/me', { credentials: 'same-origin' })
        .then(r => r.json())
        .then(data => {
          if (data && data.authenticated) {
            swapToDashboard();
          }
        })
        .catch(() => {});
    }, 50);
  }

  function swapToDashboard() {
    // Find by class first, then by href as fallback
    const nav = document.getElementById('poy-nav');
    const drawer = document.getElementById('poy-nav-drawer');

    if (nav) {
      const cta = nav.querySelector('.poy-nav-cta') || nav.querySelector('a[href="/apply.html"]');
      if (cta) {
        cta.setAttribute('href', '/dashboard/');
        cta.innerHTML = '⚡ My Dashboard';
      }
    }

    if (drawer) {
      const cta = drawer.querySelector('.poy-nav-cta') || drawer.querySelector('a[href="/apply.html"]');
      if (cta) {
        cta.setAttribute('href', '/dashboard/');
        cta.textContent = '⚡ My Dashboard';
      }
    }
  }

  // ── INJECT ───────────────────────────────────────────────────────
  function inject() {
    ensureFonts();

    const style = document.createElement('style');
    style.id = 'poy-nav-styles';
    style.textContent = CSS;
    document.head.appendChild(style);

    // Build nav (unauthenticated by default — swapped async if logged in)
    document.body.insertAdjacentHTML('afterbegin', buildNav(false));

    // Check auth and update nav if candidate is logged in
    checkAuthAndUpdate();

    // Close drawer when clicking outside
    document.addEventListener('click', function (e) {
      const drawer = document.getElementById('poy-nav-drawer');
      const hamburger = document.querySelector('.poy-hamburger');
      if (drawer && !drawer.contains(e.target) && !hamburger?.contains(e.target)) {
        drawer.classList.remove('open');
      }
    });
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

})();

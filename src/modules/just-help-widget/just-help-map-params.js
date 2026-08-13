/**
 * JUST HELP MAP — URL PARAMETER HANDLER
 * 
 * Add this script to Just Help's map page (map.html or wherever the
 * Leaflet map and checkbox filters live).
 * 
 * Place a <script src="just-help-map-params.js"></script> tag at the
 * bottom of the map page's <body>, AFTER the map and filter JS has loaded.
 * 
 * What it does:
 *   Reads URL params passed by the Party of You widget:
 *     ?location=53221&services=food,shelter,clothing
 * 
 *   Then:
 *     1. Fills the location input with the location value
 *     2. Checks/unchecks the service checkboxes to match
 *     3. Auto-triggers the search so results appear immediately
 *        (the user lands on a live map, not a blank one)
 * 
 * Param format:
 *   location  — zip code or city name string (required)
 *   services  — comma-separated service IDs (optional; if absent, all checked)
 * 
 * Just Help service IDs (must match the checkbox values in map.html):
 *   food, shelter, domestic_violence, clothing, rent_assistance,
 *   utility, healthcare, dental, holiday_meals, holiday_gifts, school_supplies
 * 
 * INTEGRATION STEPS for Just Help repo:
 *   1. Copy this file into Just Help's public/ or static/ directory
 *   2. Add to map.html:  <script src="/just-help-map-params.js"></script>
 *   3. Make sure the selectors below match the actual IDs in map.html
 *      (check SELECTORS config object and update if needed)
 *   4. Deploy — the widget deep links will start working immediately
 */

(function () {
  'use strict';

  // ── SELECTORS CONFIG ──────────────────────────────────────────────
  // Update these to match the actual element IDs/selectors in map.html
  // Check Just Help's map.html for the correct names
  const SELECTORS = {
    // The location/zip input field on the map page
    locationInput: '#zip-input, #location-input, #search-input, input[type="text"]',

    // The search/submit button that triggers the map search
    searchButton: '#search-btn, #find-btn, button[type="submit"]',

    // Each service checkbox — they should have value= matching the service IDs
    serviceCheckbox: 'input[type="checkbox"][name="service"], input[type="checkbox"].service-filter',

    // Optional: the "select all" checkbox if one exists
    selectAllCheckbox: '#select-all, #all-services',
  };
  // ─────────────────────────────────────────────────────────────────

  // All valid service IDs — must match checkbox values in map.html
  const ALL_SERVICE_IDS = [
    'food',
    'shelter',
    'domestic_violence',
    'clothing',
    'rent_assistance',
    'utility',
    'healthcare',
    'dental',
    'holiday_meals',
    'holiday_gifts',
    'school_supplies',
  ];

  function init() {
    const params = new URLSearchParams(window.location.search);
    const location = params.get('location');
    const servicesParam = params.get('services');

    // Nothing to do if no params were passed
    if (!location && !servicesParam) return;

    // Small delay to ensure the map page's own JS has fully initialized
    setTimeout(() => {
      if (location) applyLocation(location);
      if (servicesParam) applyServices(servicesParam);
      else ensureAllChecked();  // No services param = show all

      // Auto-trigger the search
      triggerSearch();
    }, 150);
  }

  function applyLocation(location) {
    const input = document.querySelector(SELECTORS.locationInput);
    if (!input) {
      console.warn('[Just Help Widget] Could not find location input. Check SELECTORS.locationInput');
      return;
    }

    // Set the value
    input.value = location;

    // Dispatch input/change events so any reactive listeners fire
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function applyServices(servicesParam) {
    const requested = servicesParam.split(',').map(s => s.trim().toLowerCase());
    const checkboxes = document.querySelectorAll(SELECTORS.serviceCheckbox);

    if (!checkboxes.length) {
      console.warn('[Just Help Widget] Could not find service checkboxes. Check SELECTORS.serviceCheckbox');
      return;
    }

    checkboxes.forEach(cb => {
      const shouldBeChecked = requested.includes(cb.value.toLowerCase());
      if (cb.checked !== shouldBeChecked) {
        cb.checked = shouldBeChecked;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    // If all services are requested, also check the "select all" box if it exists
    const allRequested = ALL_SERVICE_IDS.every(id => requested.includes(id));
    if (allRequested) {
      const selectAll = document.querySelector(SELECTORS.selectAllCheckbox);
      if (selectAll) selectAll.checked = true;
    }
  }

  function ensureAllChecked() {
    // No services param means the user didn't filter — check everything
    const checkboxes = document.querySelectorAll(SELECTORS.serviceCheckbox);
    checkboxes.forEach(cb => {
      if (!cb.checked) {
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  function triggerSearch() {
    // Try clicking the search button
    const btn = document.querySelector(SELECTORS.searchButton);
    if (btn) {
      btn.click();
      return;
    }

    // Fallback: dispatch a submit event on the nearest form
    const form = document.querySelector('form');
    if (form) {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return;
    }

    // Last resort: dispatch a custom event the map page can listen for
    document.dispatchEvent(new CustomEvent('justhelp:search-requested', {
      detail: { source: 'widget-deeplink' },
      bubbles: true,
    }));

    console.info('[Just Help Widget] No search button found. Dispatched justhelp:search-requested event.');
    console.info('[Just Help Widget] Add this to map.js to handle it:');
    console.info('  document.addEventListener("justhelp:search-requested", () => runSearch());');
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

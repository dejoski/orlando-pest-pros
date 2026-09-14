/* Orlando Pest Pros — first-party analytics snippet.
 *
 * Dependency-free vanilla JS. No cookies, no fingerprinting, no PII.
 * Tracks: pageview, tel: link taps, quote-form starts, quote-form submits.
 *
 * Install: drop this file in the site's `public/` folder as `track.js`,
 * then add `<script src="/track.js" defer></script>` before </body> in the
 * base layout. The quote form needs a `data-quote-form` attribute (see INTEGRATION.md).
 */
(function () {
  'use strict';

  var ENDPOINT = '/api/track';
  var DEDUP_WINDOW_MS = 5000; // ignore repeat fires of same event within 5s

  function pagePath() {
    var p = location.pathname.replace(/\/+$/, '') || '/';
    return p.slice(0, 120);
  }

  // In-memory dedupe: kills rapid double-fires (double-tap on tel: links,
  // double submit clicks, bfcache re-runs, etc.)
  var recent = {};
  function isDuplicate(type) {
    var key = type + ':' + pagePath();
    var now = Date.now();
    if (recent[key] && now - recent[key] < DEDUP_WINDOW_MS) return true;
    recent[key] = now;
    return false;
  }

  function send(type) {
    if (navigator.webdriver) return; // headless automation / bots
    if (isDuplicate(type)) return;
    var payload = { t: type, p: pagePath() };
    // Per-interaction UUID lets the server dedupe conversion events
    // (double-taps, retried submits). Pageviews skip it to save a command.
    if (type !== 'pv' && window.crypto && typeof crypto.randomUUID === 'function') {
      payload.did = crypto.randomUUID();
    }
    var body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon) {
        var ok = navigator.sendBeacon(
          ENDPOINT,
          new Blob([body], { type: 'application/json' })
        );
        if (ok) return;
      }
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true
      }).catch(function () {});
    } catch (e) {
      /* analytics must never break the page */
    }
  }

  // 1. Pageview
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    send('pv');
  } else {
    document.addEventListener('DOMContentLoaded', function () { send('pv'); });
  }

  // 2. tel: link taps (delegated — catches dynamically injected links too)
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('a[href^="tel:"]') : null;
    if (el) send('tel');
  }, true);

  // 3 + 4. Quote form: first focus inside the form = start, submit = submit.
  // Requires <form data-quote-form ...> on the quote form (see INTEGRATION.md).
  var form = document.querySelector('form[data-quote-form]');
  if (form) {
    var started = false;
    form.addEventListener('focusin', function () {
      if (!started) { started = true; send('form_start'); }
    });
    form.addEventListener('submit', function () { send('form_submit'); });
  }
})();

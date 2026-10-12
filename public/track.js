/* Orlando Pest Pros — first-party analytics snippet.
 *
 * Dependency-free vanilla JS. No cookies, no fingerprinting, no PII.
 * Tracks: pageview, tel: link taps, quote-form starts (accepted leads are counted server-side).
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

  // Session first-touch attribution. Never store raw URLs, query strings, or
  // arbitrary referrer hosts. Private dashboard visits are excluded entirely.
  if (/^\/(?:dash-|api\/)/.test(location.pathname)) return;
  function attribution() {
    var key = 'opp:attribution:v1';
    try {
      var saved = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (saved && ['organic', 'paid', 'referral', 'direct'].indexOf(saved.channel) >= 0) return saved;
    } catch (e) {}
    var channel = 'direct', referrer = '';
    try {
      var host = new URL(document.referrer).hostname.toLowerCase();
      if (host !== location.hostname) {
        var engines = { google: /(^|\.)google\.[a-z.]+$/, bing: /(^|\.)bing\.com$/, duckduckgo: /(^|\.)duckduckgo\.com$/, yahoo: /(^|\.)search\.yahoo\.com$/, brave: /(^|\.)search\.brave\.com$/ };
        channel = 'referral';
        Object.keys(engines).some(function (name) {
          if (engines[name].test(host)) { channel = 'organic'; referrer = name; return true; }
          return false;
        });
      }
    } catch (e) {}
    var params = new URLSearchParams(location.search);
    if (params.has('gclid') || params.has('msclkid') || /^(cpc|ppc|paid|paidsearch|paid_social)$/i.test(params.get('utm_medium') || '')) { channel = 'paid'; referrer = ''; }
    var result = { channel: channel, referrer: referrer, landingPage: pagePath() };
    try { sessionStorage.setItem(key, JSON.stringify(result)); } catch (e) {}
    return result;
  }
  var firstTouch = attribution();
  window.oppAttribution = function () { return firstTouch; };

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
    var payload = { t: type, p: pagePath(), channel: firstTouch.channel };
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

  // 3. Quote form: first focus inside the form = start.
  // Requires <form data-quote-form ...> on the quote form (see INTEGRATION.md).
  var form = document.querySelector('form[data-quote-form]');
  if (form) {
    var started = false;
    form.addEventListener('focusin', function () {
      if (!started) { started = true; send('form_start'); }
    });
    // Accepted submissions are counted by /api/quote after durable storage.
  }
})();


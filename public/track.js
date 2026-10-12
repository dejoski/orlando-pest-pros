/* Orlando Pest Pros — first-party analytics snippet.
 *
 * Dependency-free vanilla JS. No cookies, no fingerprinting, no PII.
 * Only captures session attribution locally; no network requests. Accepted leads are counted server-side.
 *
 * Install: drop this file in the site's `public/` folder as `track.js`,
 * then add `<script src="/track.js" defer></script>` before </body> in the
 * base layout. The quote form needs a `data-quote-form` attribute (see INTEGRATION.md).
 */
(function () {
  'use strict';


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

})();

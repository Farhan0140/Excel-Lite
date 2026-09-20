// Apply the saved theme before first paint so there is no flash of the wrong colours.
(function () {
  try {
    var t = JSON.parse(localStorage.getItem('household-ledger-theme') || '{}');
    var mode = t.mode || 'system';
    var dark = mode === 'dark' || (mode === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var d = document.documentElement;
    d.setAttribute('data-mode', dark ? 'dark' : 'light');
    if (t.palette) d.setAttribute('data-palette', t.palette);
  } catch (e) {}
})();
    
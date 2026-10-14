(() => {
  const paths = {
    compass:'<circle cx="12" cy="12" r="9"/><path d="m16 8-3 5-5 3 3-5Z"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-14 4h2m3 0h2m3 0h1m-11 4h2m3 0h2"/>',
    bookmark:'<path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4Z"/>',
    search:'<circle cx="10.8" cy="10.8" r="7"/><path d="m16 16 5 5"/>',
    'chevron-left':'<path d="m15 5-7 7 7 7"/>',
    'chevron-right':'<path d="m9 5 7 7-7 7"/>',
    plus:'<path d="M12 4v16M4 12h16"/>', minus:'<path d="M4 12h16"/>',
    play:'<path d="m8 4 12 8-12 8Z"/>',
    grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    list:'<path d="M4 6h16M4 12h16M4 18h16"/>',
    bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9M10 21h4"/>',
    'bell-ring':'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9M10 21h4M3 3 1 6m20-3 2 3"/>',
    star:'<path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z"/>',
    'arrow-right':'<path d="M4 12h16m-7-7 7 7-7 7"/>',
    close:'<path d="m5 5 14 14M19 5 5 19"/>', check:'<path d="m4 12 5 5L20 6"/>',
    user:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="m9 3 1-2h4l1 2 3 2 3 1v4l-2 2 2 2v4l-3 1-3 2-1 2h-4l-1-2-3-2-3-1v-4l2-2-2-2V6l3-1Z"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    filter:'<path d="m8 4-4 4 4 4M4 8h16M8 16h12m-8 4h8"/>'
  };
  window.icon = (name) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths['arrow-right']}</svg>`;
  document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = window.icon(el.dataset.icon));
})();

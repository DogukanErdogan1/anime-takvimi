(() => {
  if (window.__animeSiteBooted) return;
  window.__animeSiteBooted = true;
  (async () => {
    for (const name of ['icons.js','data-provider.js','app.js','membership.js']) {
      await new Promise((resolve,reject) => {
        const script = document.createElement('script');
        script.src = '/site/' + name;
        script.async = false;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
  })().catch(() => {
    const status = document.getElementById('account-status');
    if (status) status.textContent = 'Site dosyaları yüklenemedi. Sayfayı yenileyerek tekrar deneyin.';
  });
})();

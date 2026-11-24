// The presentation page: one 1920x1080 slide at a time, scaled to fit, with buttons, arrow keys and #slide-N links.
// Save as PDF prints every slide, one per page. No data leaves the page. By crm.dev.a@AgentiCCells.dinis, 2026-11-24. Apache-2.0.
(() => {
  const deck = document.getElementById('deck'), slides = [...deck.querySelectorAll('section.slide')], n = slides.length;
  const count = document.getElementById('count'), prev = document.getElementById('prev'), next = document.getElementById('next');
  let i = 0;
  const fit = () => { const w = deck.parentElement.clientWidth, s = Math.min(w / 1920, (document.fullscreenElement ? window.innerHeight : Infinity) / 1080); deck.style.setProperty('--scale', s); deck.parentElement.style.height = Math.round(1080 * s) + 'px'; };
  const show = (k, push = true) => {
    i = Math.max(0, Math.min(n - 1, k));
    slides.forEach((s, j) => { s.hidden = j !== i; s.setAttribute('aria-hidden', j !== i ? 'true' : 'false'); });
    count.textContent = `${i + 1} / ${n}`; prev.disabled = i === 0;
    const last = i === n - 1, after = document.querySelector('.learn-nav .learn-next');
    next.textContent = last && after ? 'Next step →' : 'Next →'; next.dataset.last = last ? '1' : '';
    if (push) history.replaceState(null, '', '#slide-' + (i + 1));
  };
  prev.addEventListener('click', () => show(i - 1));
  next.addEventListener('click', () => { if (next.dataset.last) { const a = document.querySelector('.learn-nav .learn-next'); if (a) location.href = a.href; } else show(i + 1); });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); next.click(); }
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); show(i - 1); }
    else if (e.key === 'Home') show(0); else if (e.key === 'End') show(n - 1);
  });
  document.getElementById('full').addEventListener('click', () => { const f = deck.parentElement; (document.fullscreenElement ? document.exitFullscreen() : f.requestFullscreen?.())?.catch?.(() => {}); });
  document.addEventListener('fullscreenchange', fit);
  document.getElementById('pdf').addEventListener('click', (e) => { e.preventDefault(); window.print(); });
  window.addEventListener('resize', fit);
  const m = /^#slide-(\d+)$/.exec(location.hash); show(m ? +m[1] - 1 : 0, !!m); fit();
})();

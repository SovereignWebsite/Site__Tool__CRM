// a.crm.studio player: animates a capture's scenes.json in the browser (no video file).
// Each scene shows a screen of the CRM's demo (a WebP), moves an amber frame onto what the caption is about, and the
// presenter says the caption with the browser's own speech (speechSynthesis): no audio files, nothing sent anywhere.
// Markup: <div class="player" data-src="<slug>/scenes.json"></div>. Plain script, no libraries, no network but this site.
(() => {
  const BOT = `<svg class="bot" viewBox="0 0 120 170" role="img" aria-label="Studio, a synthetic presenter made by code">
  <line x1="60" y1="6" x2="60" y2="22" stroke="#4b5563" stroke-width="3"/><circle class="light" cx="60" cy="7" r="5" fill="#e0a100"/>
  <rect x="14" y="22" width="92" height="74" rx="18" fill="#e9ecef" stroke="#4b5563" stroke-width="3"/>
  <rect x="24" y="31" width="72" height="56" rx="12" fill="#fff" stroke="#c9ced4" stroke-width="2"/>
  <ellipse class="eye" cx="46" cy="53" rx="6" ry="7" fill="#16181a"/><ellipse class="eye" cx="74" cy="53" rx="6" ry="7" fill="#16181a"/>
  <rect class="mouth" x="49" y="67" width="22" height="9" rx="4.5" fill="#2f6b4f"/>
  <rect x="50" y="96" width="20" height="8" fill="#4b5563"/>
  <rect x="22" y="104" width="76" height="58" rx="14" fill="#2f6b4f" stroke="#244f3b" stroke-width="3"/>
  <rect x="44" y="118" width="32" height="18" rx="4" fill="#fff3cc" stroke="#e0a100" stroke-width="2"/>
  <text x="60" y="131" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" font-weight="700" fill="#5a4100">CRM</text>
  <path d="M22 116 q-14 12 -12 34" stroke="#4b5563" stroke-width="7" stroke-linecap="round" fill="none"/>
  <g class="arm"><path d="M98 116 q16 -6 18 -26" stroke="#4b5563" stroke-width="7" stroke-linecap="round" fill="none"/><circle cx="116" cy="88" r="6" fill="#e0a100"/></g>
</svg>`;
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const speech = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  let voice = null;
  const pickVoice = () => { if (!speech) return; const vs = speechSynthesis.getVoices();
    voice = vs.find((v) => v.lang === 'en-GB' && /natural|neural|google|daniel|libby|sonia|ryan/i.test(v.name)) || vs.find((v) => v.lang === 'en-GB') || vs.find((v) => /^en/.test(v.lang)) || null; };
  if (speech) { pickVoice(); speechSynthesis.addEventListener?.('voiceschanged', pickVoice); }

  async function mount(root) {
    const base = root.dataset.src.replace(/[^/]*$/, '');
    const data = await (await fetch(root.dataset.src)).json();
    const n = data.scenes.length;
    root.innerHTML = '';
    const top = el('div', 'p-top', `<span class="mark"></span><span>${esc(data.title)}</span><span class="chip">${esc(data.presenter)} · synthetic presenter</span>`);
    const stage = el('div', 'p-stage'); const screen = el('div', 'p-screen'); const view = el('div', 'p-view'); const box = el('div', 'p-box'); const card = el('div', 'p-card');
    const imgs = {}; for (const s of data.scenes) if (s.screen && !imgs[s.screen]) { const i = el('img'); i.src = base + s.screen; i.alt = ''; i.decoding = 'async'; imgs[s.screen] = i; view.append(i); }
    view.append(box); screen.append(view, card);
    const pres = el('div', 'p-presenter', BOT + `<span class="who">${esc(data.presenter)}: synthetic, made by code</span>`);
    stage.append(screen, pres);
    const cap = el('div', 'p-caption'); cap.setAttribute('aria-live', 'polite');
    const ctl = el('div', 'p-controls');
    const play = el('button', 'primary', 'Play'); play.type = 'button';
    const prev = el('button', '', 'Previous'); prev.type = 'button';
    const next = el('button', '', 'Next'); next.type = 'button';
    const vLabel = el('label'); const vBox = el('input'); vBox.type = 'checkbox'; vBox.checked = speech; vBox.disabled = !speech; vLabel.append(vBox, document.createTextNode(speech ? 'Voice' : 'Voice (not in this browser)'));
    const bar = el('div', 'p-bar'); bar.setAttribute('aria-hidden', 'true'); const segs = data.scenes.map(() => { const i = el('i'); i.append(el('b')); bar.append(i); return i; });
    ctl.append(play, prev, next, vLabel, bar);
    const note = el('p', 'p-note', `Demo mode: every company, person and email is made up. The voice is your browser's own speech, reading the caption. Captured from ${esc(data.site)} ${esc(data.site_version || '')}.`);
    root.append(top, stage, cap, ctl, note);

    let at = 0, playing = false, timer = null, token = 0;
    const show = (k) => {
      const s = data.scenes[k];
      for (const [name, i] of Object.entries(imgs)) i.classList.toggle('on', name === s.screen);
      card.classList.toggle('on', !!s.card);
      if (s.card) card.innerHTML = `<div class="kicker">CRM · explainer</div><h2>${esc(s.card.title)}</h2><p>${esc(s.card.sub)}</p>${s.card.foot ? `<p class="foot">${esc(s.card.foot)}</p>` : ''}`;
      if (s.box) { const W = data.width, H = data.height; Object.assign(box.style, { left: `${s.box.x / W * 100}%`, top: `${s.box.y / H * 100}%`, width: `${s.box.w / W * 100}%`, height: `${s.box.h / H * 100}%` });
        // A small mark gets a gentle zoom; the screen and its frame zoom together, so the frame stays on its mark.
        view.style.transformOrigin = `${(s.box.x + s.box.w / 2) / W * 100}% ${(s.box.y + s.box.h / 2) / H * 100}%`; view.style.transform = s.box.w * s.box.h < W * H * 0.2 ? 'scale(1.06)' : 'scale(1)'; } else view.style.transform = 'scale(1)';
      box.classList.toggle('on', !!s.box);
      const words = s.caption.split(/(\s+)/);
      cap.innerHTML = `<span class="n">${k + 1} / ${n}</span><span class="t">${words.map((w) => /^\s+$/.test(w) ? w : `<span class="w">${esc(w)}</span>`).join('')}</span>`;
      segs.forEach((g, j) => { g.classList.toggle('done', j < k); g.firstChild.style.transition = 'none'; g.firstChild.style.width = j < k ? '100%' : '0'; });
      at = k;
    };
    const say = (text, my) => new Promise((done) => {
      if (!speech || !vBox.checked) return done();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text); if (voice) u.voice = voice; u.lang = voice?.lang || 'en-GB'; u.rate = 1;
      const spans = [...cap.querySelectorAll('.w')]; let starts = []; { let p = 0; for (const w of text.split(/(\s+)/)) { if (!/^\s+$/.test(w)) starts.push(p); p += w.length; } }
      u.onstart = () => my === token && root.classList.add('speaking');
      u.onboundary = (e) => { if (my !== token) return; const idx = starts.filter((s) => s <= e.charIndex).length; spans.forEach((sp, j) => sp.classList.toggle('said', j < idx)); };
      let ended = false;
      u.onend = u.onerror = () => { if (ended) return; ended = true; if (my === token) { root.classList.remove('speaking'); spans.forEach((sp) => sp.classList.add('said')); } done(); };
      // Some browsers have the API but no voice and never end: give up after a generous reading time.
      setTimeout(() => u.onend(), 2500 + text.split(/\s+/).length * 520);
      speechSynthesis.speak(u);
    });
    const wait = (ms) => new Promise((r) => { timer = setTimeout(r, ms); });
    const run = async () => {
      const my = ++token;
      while (playing && my === token && at < n) {
        show(at); const s = data.scenes[at]; const g = segs[at].firstChild;
        const ms = s.seconds * 1000; requestAnimationFrame(() => { g.style.transition = `width ${ms}ms linear`; g.style.width = '100%'; });
        await Promise.all([say(s.caption, my), wait(vBox.checked && speech ? Math.min(ms, 2500) : ms)]);
        if (my !== token || !playing) return;
        await wait(700); if (my !== token || !playing) return;
        if (at === n - 1) { stop(); return; } at++;
      }
    };
    const stop = () => { playing = false; token++; clearTimeout(timer); if (speech) speechSynthesis.cancel(); root.classList.remove('speaking'); play.textContent = at === n - 1 ? 'Play again' : 'Play'; };
    play.onclick = () => { if (playing) return stop(); if (play.textContent === 'Play again') at = 0; playing = true; play.textContent = 'Pause'; run(); };
    prev.onclick = () => { const was = playing; stop(); show(Math.max(0, at - 1)); if (was) play.onclick(); };
    next.onclick = () => { const was = playing; stop(); show(Math.min(n - 1, at + 1)); if (was) play.onclick(); };
    vBox.onchange = () => { if (!vBox.checked && speech) { speechSynthesis.cancel(); root.classList.remove('speaking'); } };
    show(0);
  }
  for (const r of document.querySelectorAll('.player[data-src]')) mount(r).catch((e) => { r.textContent = `This player could not load its scenes (${e.message}).`; });
})();

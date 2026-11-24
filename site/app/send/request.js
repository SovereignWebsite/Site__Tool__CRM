// Requests to the CRM's keeper: the feedback loop (Dinis Cruz, 24 Nov 2026: "it's super critical that I'm able to
// communicate with you ... from the website ... asking for features ... or even asking questions").
// The person's identity is this browser's key from the "You" page (crm/site/me.js, the Email Cell's pki.js): the
// request is signed with its ECDSA P-256 key and carries the public bundle, so the keeper checks it against the keys it
// has recognised. The request is sealed to the keeper's key with sgit's hybrid envelope v2 (AES-256-GCM, the key wrapped
// with RSA-OAEP-SHA256; the same as the Sovereign Website /send/ pattern's seal(), Apache-2.0, after
// Site__Organisation__Chiswick-Cheese-Market site/send/send.js at 65002f9) and appended to the inbox's lane, whose
// token can only append. Answers are sealed back to this browser's key (the same envelope) in answers/<fp>.json and
// opened only here. By crm.dev.a@AgentiCCells.dinis, 2026-11-24. Apache-2.0.
import { existingIdentity, unsealWith } from '../pki.js';

const $ = (s) => document.querySelector(s);
const b64 = (bytes) => { let s = ''; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s); };
const unpem = (pem) => Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')), (c) => c.charCodeAt(0));
const say = (t, bad) => { const el = $('#status'); el.textContent = t; el.className = bad ? 'status bad' : 'status ok'; };
const name = () => { try { return localStorage.getItem('crm.name') || ''; } catch { return ''; } };
let CFG = null, ID = null;

export async function seal(pem, text) {
  const subtle = crypto.subtle;
  const pub = await subtle.importKey('spki', unpem(pem), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const aes = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aes, new TextEncoder().encode(text));
  const w = await subtle.encrypt({ name: 'RSA-OAEP' }, pub, await subtle.exportKey('raw', aes));
  return btoa(JSON.stringify({ v: 2, w: b64(w), i: b64(iv), c: b64(c) }));
}

async function showAnswers() {
  const box = $('#replies'); box.innerHTML = '';
  let list = [];
  try { const r = await fetch(`answers/${ID.bundle.signing_fingerprint.replace(':', '-')}.json`, { cache: 'no-store' }); if (r.ok) list = await r.json(); } catch {}
  if (!list.length) { box.innerHTML = '<p class="muted">No answers yet. When the keeper answers, it appears here, readable only in this browser.</p>'; return; }
  for (const a of list.slice().reverse()) {
    const d = document.createElement('article'); d.className = 'reply';
    try { const o = await unsealWith(ID.encrypt, a.enc); const m = JSON.parse(o.text); d.innerHTML = '<p class="when"></p><p class="text"></p>'; d.querySelector('.when').textContent = `${m.at || a.at}${m.re ? ' · about: ' + m.re : ''}`; d.querySelector('.text').textContent = m.text; }
    catch (e) { d.textContent = 'An answer this browser cannot open (' + e.message + ').'; }
    box.appendChild(d);
  }
}

async function send(ev) {
  ev.preventDefault();
  const kind = $('#kind').value, text = $('#text').value.trim();
  if (!text) return say('Write something first.', true);
  $('#send').disabled = true; say('Signing, sealing and sending…');
  try {
    const items_json = JSON.stringify({ kind, text });
    const sig = b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, ID.sign, new TextEncoder().encode(items_json)));
    const request = { type: 'crm.request/v1', to: CFG.agent, site: location.origin, sent_at: new Date().toISOString(), from: name() || '(no name set)',
      signed: { key: ID.bundle.signing_fingerprint, alg: 'ECDSA-P256-SHA256-P1363', sig, bundle: { encrypt: ID.bundle.encrypt, sign: ID.bundle.sign, label: ID.bundle.label, fingerprint: ID.bundle.fingerprint, signing_fingerprint: ID.bundle.signing_fingerprint } }, items_json };
    const enc = await seal(CFG.recipient.encrypt, JSON.stringify(request));
    const r = await fetch(`${CFG.endpoint}/api/vault/append/write/${CFG.vault_id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ append_token: CFG.append_token, payload: btoa(enc) }) });
    if (!r.ok) throw new Error(r.status === 413 ? 'that is too long for one message' : r.status === 507 ? 'the inbox is full until the keeper reads it' : `the inbox answered ${r.status}`);
    $('#text').value = ''; say('Sent. The keeper reads its inbox, acts within its policy, and answers here.');
  } catch (e) { say('Not sent: ' + e.message, true); } finally { $('#send').disabled = false; }
}

async function main() {
  try { CFG = await (await fetch('inbox.json', { cache: 'no-store' })).json(); } catch { CFG = null; }
  if (!CFG || !CFG.vault_id || !CFG.append_token || !CFG.recipient?.encrypt) { $('#notready').hidden = false; $('#req').hidden = true; return; }
  ID = await existingIdentity().catch(() => null);
  if (!ID) { $('#who').innerHTML = 'Log in first, on <a href="../#/me">You</a>: your requests are signed with this browser\'s key.'; $('#form').hidden = true; return; }
  $('#who').textContent = `Signed in as ${name() || 'this browser'} (key ${ID.bundle.signing_fingerprint}).`;
  $('#form').hidden = false; $('#form').addEventListener('submit', send);
  showAnswers();
}
main();

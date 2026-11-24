// The CRM tool site's page: lead board, company, follow-ups and contacts, over a vault read in the
// browser. Demo mode (the default, always one press away) loads the synthetic twin bundle
// (demo/twin.json). "Open your vault" reads a CRM vault, and the mail twin it points at, with the
// person's own keys, in this browser only (vault.js); remembered keys are sealed to this browser's
// own key with the Email Cell's pki.js keep/recall, unedited.
// By crm.dev.a@AgentiCCells.dinis, 2026-11-23. Apache-2.0.
import { readVault, checkCrm, leadBoard, followUps, company, contacts, unlinkedThreads, linkFile, companyFiles, personFile, newVaultFiles, newId, KINDS, actionFile, leadEditFile, timeline, ACTION_KINDS, importFiles, IMPORT_COLUMNS, theDay, FOLLOW_UP_DAYS, keyRecord, keyFile, personKey } from './crm.mjs';
import { keyKind, openVault, readAll, merge, whyNotWritable, writeFiles, createCrmVault } from './vault.js';
import { identity, existingIdentity, keep, recall, forget, kept } from './pki.js';
import * as ME from './me.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const day = (iso) => (iso ? iso.slice(0, 10) : '–');
let V = null, NOW = 0, MODE = 'demo', OPENED = null, SYNTHETIC = true, VAULT_NAME = 'Demo';
// The open CRM vault (never the twin), its manifest, and the access token for writing: memory only.
let CRMV = null, CRM_MANIFEST = null, TOKEN = '', PENDING = null, FILES = {}, NEWKEY = null, JUST_ADDED = null;
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const canEdit = () => MODE === 'demo' || !whyNotWritable(CRMV, CRM_MANIFEST);
// Who is using this browser, for "by" on what they log: kept in this browser only (a convenience, not a record).
const NAME_KEY = 'crm.name';
const myName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };
const setMyName = (n) => { try { localStorage.setItem(NAME_KEY, n); } catch {} };
const me = () => myName() || (MODE === 'demo' ? 'Owner A' : CRM_MANIFEST?.owner || '');
const today = () => new Date(MODE === 'demo' ? NOW : Date.now()).toISOString().slice(0, 10);
const idOf = (key) => (String(key).trim().match(/:([a-z0-9]{4,32})$/) || [])[1] || '?';
// The Email Cell's send screen, where a draft is reviewed and sent. In demo mode it opens the same
// synthetic contact (person id) in its own demo. Parameters agreed with mail.dev.a@AgentiCCells.dinis:
// ?demo&contact=<person-id>. The send screen is not live yet, so the link may be dead until it lands.
const SEND_URL = 'https://email-cell.agenticcells.site/app/send.html';
// Synthetic data (the demo, or a vault marked synthetic) only ever links to the send screen's demo.
const sendLink = (person) => `${SEND_URL}?${SYNTHETIC ? 'demo&' : ''}contact=${encodeURIComponent(person)}`;

function askName() {
  const n = prompt('Your name, as the team knows you (it goes on what you log):', myName());
  if (n != null && n.trim()) { setMyName(n.trim()); showName(); }
}
function showName() { const b = $('#me'); if (b) b.textContent = myName() ? `You: ${myName()}` : 'Set your name'; }

function setMode(mode, label, synthetic) {
  MODE = mode;
  SYNTHETIC = mode === 'demo' || !!synthetic;
  $('#mode').textContent = 'Vault: ' + (mode === 'demo' ? 'Demo' : VAULT_NAME) + ' ▾';
  $('#mode').title = label + ' (press to switch vault)';
  $('#mode').className = 'mode' + (mode === 'vault' ? ' mode-vault' : '');
  $('#banner').hidden = false;
  $('#banner').textContent = mode === 'demo'
    ? 'Synthetic demo: every company, person and email here is made up, at reserved example domains.'
    : synthetic
      ? `${VAULT_NAME} (${OPENED}), read in this browser only. Its manifest says it is synthetic.`
      : `${VAULT_NAME} (${OPENED}), read in this browser only. Nothing is sent anywhere else.`;
}

async function loadDemo() {
  const b = await (await fetch('demo/twin.json')).json();
  if (!b.synthetic) throw new Error('the demo bundle is not marked synthetic');
  FILES = { ...b.files };
  V = readVault(FILES);
  // The demo's clock is the twin's, so "5 days" means the same on every visit.
  NOW = Date.parse(V.manifest.generated_at);
  OPENED = null; CRMV = null; CRM_MANIFEST = null; TOKEN = ''; PENDING = null; VAULT_NAME = 'Demo';
  setMode('demo', 'Demo mode');
}

// Open the person's vaults with their keys. The keys live only in this call's memory, and are kept
// only if `remember` is set, sealed to this browser's own key.
async function loadVault(crmKey, twinKey, remember, status, token = '') {
  status('Opening the CRM vault…');
  const crmVault = await openVault(crmKey);
  const crmFiles = await readAll(crmVault, { onProgress: (n) => status(`Reading the CRM vault: ${n} files…`) });
  let twinFiles = null;
  if (twinKey) {
    status('Opening the mail twin…');
    twinFiles = await readAll(await openVault(twinKey), { onProgress: (n) => status(`Reading the mail twin: ${n} files…`) });
  }
  const m = merge(crmFiles, twinFiles);
  const want = m.crmManifest?.twin?.vault;
  if (want && !twinKey) throw new Error(`this CRM vault points at mail twin ${want}: add that vault's key too`);
  if (want && twinKey && idOf(twinKey) !== want) throw new Error(`this CRM vault points at mail twin ${want}, but the second key opens ${idOf(twinKey)}`);
  const v = readVault(m.files);
  const errors = checkCrm(v);
  if (errors.length) throw new Error('the CRM records do not check out: ' + errors.slice(0, 5).join('; '));
  if (remember) {
    status('Keeping the keys, sealed to this browser…');
    const id = await identity('crm tool page, ' + location.host);
    await keep(id, 'vault:crm', crmKey);
    if (twinKey) await keep(id, 'vault:twin', twinKey); else await forget('vault:twin');
    if (token) await keep(id, 'token:sg-send', token); else await forget('token:sg-send');
  }
  CRMV = crmVault; CRM_MANIFEST = m.crmManifest; TOKEN = token || ''; PENDING = null;
  const synthetic = !!(v.manifest?.synthetic || m.crmManifest?.synthetic);
  FILES = m.files;
  V = v;
  NOW = synthetic && v.manifest?.generated_at ? Date.parse(v.manifest.generated_at) : Date.now();
  OPENED = idOf(crmKey) + (twinKey ? ' + ' + idOf(twinKey) : '');
  VAULT_NAME = m.crmManifest?.name || idOf(crmKey);
  setMode('vault', 'Your vault' + (synthetic ? ' (synthetic)' : ''), synthetic);
}

async function openPage() {
  const remembered = await kept('vault:crm').catch(() => false);
  return `<h1>Open your vault</h1>
  <p>Read your own CRM vault in this browser. The keys are used here only: they are never sent to this site or kept in the clear. ${MODE === 'vault' ? `<strong>Open now: ${esc(OPENED)}.</strong>` : 'You are in the demo.'}</p>
  ${MODE === 'vault' ? '<p><button type="button" id="to-demo">Back to the demo</button> <span class="muted">closes your vault in this tab</span></p>' : ''}
  ${remembered ? '<p><button type="button" id="recall">Open the vault this browser remembers</button> <button type="button" id="forget" class="quiet">Forget it</button></p>' : ''}
  <form id="open" class="open" autocomplete="off">
    <label>CRM vault key <input id="k-crm" type="password" spellcheck="false" placeholder="sgit_private_vault_… or sgit_private_read_…:id" required></label>
    <label>Mail twin key <span class="muted">(if the CRM vault points at one)</span> <input id="k-twin" type="password" spellcheck="false" placeholder="sgit_private_read_…:id"></label>
    <label>SG/Send access token <span class="muted">(only needed to write links)</span> <input id="k-token" type="password" spellcheck="false"></label>
    <label class="check"><input id="remember" type="checkbox"> Remember on this device, sealed to this browser's own key</label>
    <button type="submit">Open</button>
  </form>
  <p id="status" class="muted" role="status"></p>
  <h2 id="create">Start a new CRM vault</h2>
  <p>Makes an empty, encrypted CRM vault on the vault service with your access token, marked as yours. Your companies and contacts then live there, not on this site. If you are logged in (You), it is added to your vaults, locked to this browser; you also see its key once: keep it in your password manager too.</p>
  <form id="create" class="open" autocomplete="off">
    <label>Your name <span class="muted">(owner of the vault and its leads)</span> <input id="c-owner" type="text" value="${esc(myName())}" required></label>
    <label>Vault name <input id="c-name" type="text" placeholder="for example: My CRM"></label>
    <label>SG/Send access token <input id="c-token" type="password" spellcheck="false" required></label>
    <label class="check"><input id="c-remember" type="checkbox"> Remember the vault on this device, sealed to this browser's own key</label>
    <button type="submit">Create my CRM vault</button>
  </form>
  <p id="c-status" class="muted" role="status"></p>`;
}

function newKeyPanel() {
  if (!NEWKEY) return '';
  return `<section class="pending" id="newkey"><h2>Your new CRM vault: ${esc(idOf(NEWKEY))}</h2>
  <p>This is its key. It is the only way back into the vault, and this page will not show it again. Copy it somewhere safe (a password manager) now.</p>
  <p><input id="nk" type="text" readonly value="${esc(NEWKEY)}" class="key"> <button type="button" id="nk-copy" class="quiet">Copy</button></p>
  <p><button type="button" id="nk-done">I have saved it</button></p></section>`;
}

function wireOpen() {
  const status = (t, bad) => { const el = $('#status'); if (el) { el.textContent = t; el.className = bad ? 'warn' : 'muted'; } };
  const go = (crm, twin, remember, token) => loadVault(crm, twin, remember, status, token).then(() => { location.hash = '#/today'; route(); }).catch((e) => status('Could not open: ' + e.message, true));
  $('#open')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const crm = $('#k-crm').value.trim(), twin = $('#k-twin').value.trim();
    if (!keyKind(crm)) return status('That does not look like a vault key or a read key.', true);
    if (twin && !keyKind(twin)) return status('The mail twin key does not look like a vault key or a read key.', true);
    const token = $('#k-token').value.trim();
    $('#k-crm').value = ''; $('#k-twin').value = ''; $('#k-token').value = '';
    go(crm, twin || null, $('#remember').checked, token);
  });
  $('#recall')?.addEventListener('click', async () => {
    try {
      const id = await existingIdentity();
      if (!id) throw new Error("this browser's key is gone");
      go(await recall(id, 'vault:crm'), await recall(id, 'vault:twin'), false, (await recall(id, 'token:sg-send')) || '');
    } catch (e) { status('Could not open: ' + e.message, true); }
  });
  $('#forget')?.addEventListener('click', async () => { await forget('vault:crm'); await forget('vault:twin'); await forget('token:sg-send'); route(); });
  $('#create')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const st = (t, bad) => { $('#c-status').textContent = t; $('#c-status').className = bad ? 'warn' : 'muted'; };
    const owner = $('#c-owner').value.trim(), token = $('#c-token').value.trim(), remember = $('#c-remember').checked;
    if (!owner || !token) return st('Your name and your access token are both needed.', true);
    $('#c-token').value = '';
    try {
      st('Making your vault…');
      const name = ($('#c-name')?.value || '').trim() || `${owner}'s CRM`;
      const { key } = await createCrmVault(token, newVaultFiles({ owner, at: nowIso(), name }), { name });
      st('Opening it…');
      await loadVault(key, null, remember, st, token);
      if (await ME.loggedIn()) { await ME.addVault(key, name, 'personal'); ME.setLastVault(key.split(':').pop()); }
      NEWKEY = key; location.hash = '#/today'; route();
    } catch (e) { st('Not made: ' + e.message, true); }
  });
  $('#to-demo')?.addEventListener('click', () => loadDemo().then(() => { ME.setLastVault(null); location.hash = '#/today'; route(); }));
}

const stageName = (id) => V.stages.find((s) => s.id === id)?.name || id;
const orgName = (id) => V.orgs.find((o) => o.id === id)?.name || id;
// The first draft waiting for a company, if any.
const draftFor = (orgId) => V.drafts.find((x) => x.status === 'draft' && (x.org ?? V.people.find((p) => p.id === x.person)?.org) === orgId) || null;
function draftBadge(d, orgId) {
  const label = { draft: 'Draft waiting', sent: 'Sent', none: 'No draft' }[d.state];
  const first = d.state === 'draft' && draftFor(orgId);
  return first ? `<a class="badge d-draft" href="${esc(sendLink(first.person))}" title="Open the draft in the send screen (demo)">${label} →</a>` : `<span class="badge d-${d.state}">${label}</span>`;
}

function board() {
  const rows = leadBoard(V, NOW);
  const owners = [...new Set(rows.map((r) => r.owner).filter(Boolean))].sort();
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const owner = q.get('owner') || '';
  const shown = rows.filter((r) => !owner || r.owner === owner);
  const counts = V.stages.map((s) => ({ ...s, n: rows.filter((r) => r.stage === s.id).length })), overdue = rows.filter((r) => r.overdue).length;
  return `<h1>Lead board</h1>
  <p class="stages">${overdue ? `<span class="stage warn">Overdue <strong>${overdue}</strong></span> ` : ''}${counts.map((s) => `<span class="stage s-${esc(s.id)}">${esc(s.name)} <strong>${s.n}</strong></span>`).join(' ')}</p>${addCompanyForm()}
  <p class="filters">Owner: <a href="#/board" class="${owner ? '' : 'on'}">all</a> ${owners.map((o) => `<a href="#/board?owner=${esc(o)}" class="${o === owner ? 'on' : ''}">${esc(o)}</a>`).join(' ')}</p>
  <div class="scroll"><table class="grid">
  <thead><tr><th>Company</th><th>Stage</th><th>Owner</th><th>Draft</th><th>Last contact</th><th>Next step</th></tr></thead>
  <tbody>${shown.map((r) => `<tr>
    <td><a href="#/company/${esc(r.org)}">${esc(r.name)}</a><div class="muted small">${esc(r.kind)} · ${r.people} ${r.people === 1 ? "person" : "people"} · ${r.threads} ${r.threads === 1 ? "thread" : "threads"}</div></td>
    <td><span class="stage s-${esc(r.stage)}">${esc(stageName(r.stage))}</span></td>
    <td>${esc(r.owner || '–')}</td>
    <td>${draftBadge(r.draft, r.org)}</td>
    <td>${day(r.last_contact?.date)} <span class="muted small">${r.last_contact ? (r.last_contact.direction === 'outbound' ? 'we wrote' : 'they wrote') : ''}</span>${r.waiting ? `<div class="warn small">${r.waiting.count === 1 ? '1 thread' : r.waiting.count + ' threads'} with no reply, oldest ${r.waiting.days} days</div>` : ''}</td>
    <td>${esc(r.next_step || '–')}<div class="small ${r.overdue ? 'warn' : 'muted'}">${r.next_step_due ? (r.overdue ? 'overdue, ' : 'due ') + r.next_step_due : ''}</div></td>
  </tr>`).join('')}</tbody></table></div>`;
}

function companyPage(id) {
  const c = company(V, id, NOW);
  if (!c) return `<p>No such company. <a href="#/board">Back to the board</a></p>`;
  const who = (pid) => V.people.find((p) => p.id === pid)?.name || '';
  return `<p><a href="#/board">← Lead board</a></p>
  <h1>${esc(c.name)}</h1>
  <p class="muted">${esc(c.domain)} · ${esc(c.kind)}</p>
  <dl class="facts">
    <dt>Stage</dt><dd><span class="stage s-${esc(c.stage)}">${esc(stageName(c.stage))}</span></dd>
    <dt>Owner</dt><dd>${esc(c.owner || '–')}</dd>
    <dt>Next step</dt><dd>${esc(c.next_step || '–')} ${c.next_step_due ? `<span class="${c.overdue ? 'warn' : 'muted'}">(${c.overdue ? 'overdue, ' : 'due '}${c.next_step_due})</span>` : ''}</dd>
    <dt>Draft</dt><dd>${draftBadge(c.draft, c.org)}</dd>
  </dl>
  ${editLeadForm(c)}
  <h2>Activity</h2>${logActionForm(c)}
  <ul class="list timeline">${timeline(V, c.org).map((e) => `<li><span class="when">${day(e.at)}</span> <span class="badge">${esc(e.kind)}</span> ${e.direction === 'out' ? 'we reached out' : e.direction === 'in' ? '<strong>they replied</strong>' : 'note'}${e.person ? ' · ' + esc(who(e.person)) : ''} · ${esc(e.summary)}${e.by ? ` <span class="muted small">(${esc(e.by)})</span>` : ''}</li>`).join('') || '<li class="muted">Nothing logged yet.</li>'}</ul>
  <h2>People</h2>${addPersonForm(c.org)}
  <ul class="list">${c.contacts.map((p) => `<li>${esc(p.name)} <span class="muted">${esc(p.role || '')} · ${esc((p.emails || [])[0] || '')}</span> ${keyMark(p)}</li>`).join('') || '<li class="muted">None yet</li>'}</ul>
  <h2>Mail threads</h2>
  <ul class="list">${c.threads.map((t) => `<li id="t-${esc(t.id)}"><strong>${esc(t.subject)}</strong> <span class="muted">${day(t.last_date)} · ${t.direction === 'outbound' ? 'we wrote last' : 'they wrote last'} · ${esc(who(t.person))} · ${t.linked ? 'linked' : 'matched by address'}</span> ${linkButton(t.id, t.linked ? null : c.org, t.person)}</li>`).join('') || '<li class="muted">None</li>'}</ul>
  <h2>Drafts</h2>
  <ul class="list">${c.drafts.map((d) => `<li><strong>${esc(d.subject)}</strong> <span class="muted">to ${esc((d.to || []).join(', '))} · ${esc(d.status)}</span>${d.status === 'draft' ? ` <a href="${esc(sendLink(d.person))}">Review and send (demo) →</a>` : ''}</li>`).join('') || '<li class="muted">None</li>'}</ul>`;
}

function followUpsPage() {
  const list = followUps(V, NOW);
  return `<h1>Follow-ups</h1><p class="muted">Where we reached out last (by email, or a logged email, LinkedIn message, call or meeting) and there has been no reply in ${FOLLOW_UP_DAYS} days or more.</p>
  <div class="scroll"><table class="grid"><thead><tr><th>Days</th><th>Company</th><th>Person</th><th>What we sent</th><th>Sent</th><th><span class="sr-only">Action</span></th></tr></thead>
  <tbody>${list.map((f) => `<tr><td class="num">${f.days}</td><td>${f.org ? `<a href="#/company/${esc(f.org)}">${esc(orgName(f.org))}</a>` : '–'}</td><td>${esc(V.people.find((p) => p.id === f.person)?.name || '–')}</td><td>${esc(f.subject)}</td><td>${day(f.sent)}</td><td>${f.org ? `<a class="button small" href="#/company/${esc(f.org)}?log=1">Log the follow-up</a>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}

function contactsPage() {
  return `<h1>Contacts</h1><div class="scroll"><table class="grid"><thead><tr><th>Name</th><th>Company</th><th>Role</th><th>Email</th><th>Key</th><th>Threads</th><th>Last contact</th></tr></thead>
  <tbody>${contacts(V).map((p) => `<tr><td>${esc(p.name)}</td><td><a href="#/company/${esc(p.org)}">${esc(p.org_name)}</a></td><td>${esc(p.role || '')}</td><td>${esc(p.email)}</td><td>${p.key_fp ? `<span class="badge key" data-keycheck="${esc(p.id)}" title="${esc(p.key_fp)}">Key ${esc(short(p.key_fp))}: checking…</span>` : '<span class="muted small">none</span>'}</td><td class="num">${p.threads}</td><td>${day(p.last_contact)}</td></tr>`).join('')}</tbody></table></div>`;
}

// Hand-made links. A press shows exactly what will be written; only a second press writes it, one
// file and one commit per link, to the person's own CRM vault (never the twin). In the demo nothing
// is written anywhere: the link is made in this tab's memory only.
function linkButton(thread, org, person) {
  if (!org) return `<button type="button" class="small quiet" data-unlink="${esc(thread)}">Unlink</button>`;
  return `<button type="button" class="small quiet" data-link="${esc(thread)}" data-org="${esc(org)}" data-person="${esc(person || '')}">Link to ${esc(orgName(org))}</button>`;
}

function todayPage() {
  const d = theDay(V, NOW), why = { overdue: 'Overdue', 'follow-up': 'Follow up', draft: 'Draft waiting', soon: 'Coming up' };
  return `<h1>Today</h1>
  <p class="stages">${d.stages.map((s) => `<a class="stage s-${esc(s.id)}" href="#/board">${esc(s.name)} <strong>${s.count}</strong></a>`).join(' ')}</p>
  ${d.cards.length ? '' : '<p class="muted">Nothing needs doing today. Well done.</p>'}
  <ul class="cards">${d.cards.map((c) => `<li class="card why-${esc(c.why)}">
    <p class="card-why"><span class="badge">${why[c.why]}</span> <span class="small">${esc(c.detail)}</span></p>
    <h2><a href="#/company/${esc(c.org)}">${esc(c.name)}</a></h2>
    <p class="small muted">${esc(stageName(c.stage))} · ${esc(c.owner || 'no owner')}${c.last_contact ? ' · last contact ' + day(c.last_contact.date) : ''}</p>
    ${c.next_step ? `<p>Next: ${esc(c.next_step)}${c.next_step_due ? ` <span class="small ${c.overdue ? 'warn' : 'muted'}">(${c.overdue ? 'overdue, ' : 'due '}${esc(c.next_step_due)})</span>` : ''}</p>` : ''}
    <p class="card-actions">${c.why === 'draft' && draftFor(c.org) ? `<a class="button" href="${esc(sendLink(draftFor(c.org).person))}" title="Open the draft in the send screen${SYNTHETIC ? ' (demo)' : ''}">Review and send</a> <a class="button quiet" href="#/company/${esc(c.org)}?log=1">Log an action</a>` : `<a class="button" href="#/company/${esc(c.org)}?log=1">Log the follow-up</a>`}</p>
  </li>`).join('')}</ul>`;
}

function threadsPage() {
  const list = unlinkedThreads(V);
  return `<h1>Unlinked threads</h1><p class="muted">Mail threads with no link to a company. A link ties the thread to the company's row, whatever addresses it holds.</p>
  <div class="scroll"><table class="grid"><thead><tr><th>Thread</th><th>Last</th><th>Matched by address</th><th>Link to</th></tr></thead>
  <tbody>${list.map((t) => `<tr><td>${esc(t.subject)} <span class="muted small">${esc(t.id)}</span></td><td>${day(t.last_date)}</td><td>${t.org ? esc(orgName(t.org)) : '–'}</td>
  <td><select data-for="${esc(t.id)}" aria-label="Link ${esc(t.subject)} to">${V.orgs.map((o) => `<option value="${esc(o.id)}"${o.id === t.org ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
  <button type="button" class="small" data-link="${esc(t.id)}" data-pick="1" data-person="${esc(t.person || '')}">Link</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Every thread is linked.</td></tr>'}</tbody></table></div>`;
}

function pendingPanel() {
  if (!PENDING) return '';
  const where = MODE === 'demo' ? 'the demo, in this tab only: nothing is written anywhere' : `your CRM vault ${esc(OPENED.split(' + ')[0])}`;
  const blocked = MODE === 'vault' ? whyNotWritable(CRMV, CRM_MANIFEST) : null;
  const one = (f) => `<p><code>${esc(f.path)}</code>${f.text == null ? ' <span class="warn">removed (the vault keeps it in its history)</span>' : ''}</p>${f.text == null ? '' : `<pre>${esc(f.text)}</pre>`}`;
  const files = (PENDING.note ? `<p>${esc(PENDING.note)}</p>` : '') + (PENDING.files.length > 5 ? `<details><summary>Show all ${PENDING.files.length} files</summary>${PENDING.files.map(one).join('')}</details>` : PENDING.files.map(one).join(''));
  return `<section class="pending" id="pending"><h2>${esc(PENDING.title)}</h2>
  <p>${PENDING.files.length === 1 ? 'This file' : `These ${PENDING.files.length} files`} will be written to ${where}:</p>${files}
  ${blocked ? `<p class="warn">Cannot write: ${esc(blocked)}.</p>` : ''}
  ${MODE === 'vault' && !blocked && !TOKEN ? '<label>SG/Send access token, for this write <input id="w-token" type="password" spellcheck="false"></label>' : ''}
  <p><button type="button" id="w-go"${blocked ? ' disabled' : ''}>Write it</button> <button type="button" id="w-cancel" class="quiet">Cancel</button></p>
  <p id="w-status" class="muted" role="status"></p></section>`;
}

function ask(title, make) {
  try { const r = make(); PENDING = Array.isArray(r) ? { title, files: r } : { title, files: r.files, note: r.note }; if (!PENDING.files.length) throw new Error(PENDING.note || 'nothing to write'); }
  catch (e) { const el = $('#form-error'); if (el) el.textContent = e.message; else alert(e.message); return; }
  route();
}
const askLink = (thread, org, person) => ask('Link this thread?', () => [linkFile(V, { thread, org, person: person || null, by: me(), at: nowIso() })]);
const askUnlink = (thread) => ask('Remove this link?', () => [{ path: `crm/links/${thread}.json`, text: null }]);

async function doPending() {
  const st = (t, bad) => { $('#w-status').textContent = t; $('#w-status').className = bad ? 'warn' : 'muted'; };
  const p = PENDING;
  if (MODE === 'vault') {
    const token = TOKEN || $('#w-token')?.value.trim();
    if (!token) return st('Writing needs your SG/Send access token.', true);
    $('#w-go').disabled = true; st('Writing to your vault…');
    try { await writeFiles(CRMV, token, p.files.map(({ path, text }) => ({ path, text }))); } catch (e) { $('#w-go').disabled = false; return st('Not written: ' + e.message, true); }
  }
  for (const f of p.files) { if (f.text == null) delete FILES[f.path]; else FILES[f.path] = f.text; }
  V = readVault(FILES);
  PENDING = null; route();
}

// Forms to add a company (with its lead row) and a person. They only prepare the files: the panel
// above shows them, and only "Write it" writes.
function addCompanyForm() {
  if (!canEdit()) return '';
  return `<details class="add"><summary>Add a company</summary><form id="add-org" class="open" autocomplete="off">
    <label>Name <input id="o-name" required></label>
    <label>Domain <span class="muted">(optional, like example.com)</span> <input id="o-domain"></label>
    <label>Kind <select id="o-kind">${KINDS.map((k) => `<option>${k}</option>`).join('')}</select></label>
    <label>Next step <span class="muted">(optional)</span> <input id="o-next"></label>
    <button type="submit">Show what will be written</button> <span id="form-error" class="warn"></span></form></details>`;
}
async function mePage() {
  if (!(await ME.loggedIn())) return `<h1>Log in</h1>
  <p>Logging in makes this browser's own key. Its private half never leaves this browser and cannot be copied out. If this device has a passkey (Touch ID, Face ID, Windows Hello), the page also makes one for this site and asks for it before it uses any vault key.</p>
  <form id="login" class="open" autocomplete="off"><label>Your name <input id="li-name" value="${esc(myName())}" required></label><button type="submit">Log in</button> <span id="form-error" class="warn"></span></form>
  <p class="muted small">${(await ME.passkeyAvailable()) ? 'This device can use a passkey.' : 'This device has no passkey: the key is tied to this browser only.'}</p>`;
  const k = await ME.myKey(), list = await ME.vaults(), ja = JUST_ADDED; JUST_ADDED = null;
  const added = ja ? `<section class="added" role="status"><h2>${ja.vaults.map((v) => esc(v.name)).join(', ')} added</h2>
    <p>It was sealed to this browser and signed by ${esc(ja.from)}. It is kept here, locked to this browser's key.${ja.token ? ' An access token came with it and is kept too.' : ''}</p>
    <p>${ja.vaults.map((v) => `<button type="button" class="big" data-openv="${esc(v.id)}">Open ${esc(v.name)} now</button>`).join(' ')}</p></section>` : '';
  const handover = `<div class="handover">
    <section class="give">
      <h2>1. Send this</h2>
      <p>Copy your QR code and send it to Dinis on WhatsApp. It is public.</p>
      <img src="${k.qr}" alt="QR code of this browser's public key" class="qr">
      <p><button type="button" id="copyqr">Copy QR image</button> <button type="button" id="copykey" class="quiet">Copy as text</button></p>
      <p id="copy-status" class="muted small" role="status"></p>
      <textarea id="mykey" rows="2" readonly spellcheck="false" aria-label="Your public key as text">${esc(k.text)}</textarea>
    </section>
    <section class="take">
      <h2>2. Drop what you get back</h2>
      <p>When you are sent a QR code back, drop the picture here, or paste it (Ctrl+V or Cmd+V anywhere on this page), or paste its text.</p>
      <div id="drop" class="drop" tabindex="0" role="button" aria-label="Drop or paste the QR code you were sent">Drop or paste the QR code here</div>
      <p><label class="small">or choose the picture <input id="qrfile" type="file" accept="image/*"></label></p>
      <form id="receive" class="open" autocomplete="off"><label class="small">or paste its text <textarea id="rc-text" rows="2" spellcheck="false"></textarea></label><button type="submit" class="small">Open it</button></form>
      <p id="rc-status" class="muted" role="status"></p>
    </section>
  </div>`;
  return `<h1>You${myName() ? ': ' + esc(myName()) : ''}</h1>
  ${added}
  <p class="muted small">This browser's key: <code>${esc(k.fp)}</code>. ${ME.hasPasskey() ? 'Locked with a passkey.' : 'No passkey on this device: the key is tied to this browser.'} Its private half never leaves this browser.</p>
  ${list.length ? '' : handover}
  <h2>Your vaults</h2>
  <ul class="list vaults">${list.map((v) => `<li><strong>${esc(v.name)}</strong> <span class="muted small">${esc(v.id)} · added ${esc(v.added)}</span> <button type="button" class="small" data-openv="${esc(v.id)}">Open</button> <button type="button" class="small quiet" data-vaultapp="${esc(v.id)}" title="Open this vault in the SG/Send vault app, in a new tab">Open in the vault app ↗</button> <button type="button" class="small quiet" data-forgetv="${esc(v.id)}">Forget</button></li>`).join('') || '<li class="muted">None yet: send your QR code (1), then drop what you get back (2).</li>'}</ul>
  <p><a class="button" href="#/open#create">Start a personal CRM vault</a> <span class="muted small">for your own contacts, only yours</span></p>
  ${list.length ? `<details class="add"><summary>Add another vault (from someone else)</summary>${handover}</details>` : ''}
  <p id="v-status" class="muted" role="status"></p>
  <p><button type="button" id="logout" class="quiet small">Log out of this browser</button> <span class="muted small">removes the vault keys kept here; your vaults themselves are not touched</span></p>`;
}

function importPage() {
  if (!canEdit()) return `<h1>Import</h1><p>Open your CRM vault with a key that can write to import into it.</p>`;
  return `<h1>Import contacts</h1>
  <p>Fill in a spreadsheet, one line per person (or per company), save it as CSV and paste it below or choose the file. <a href="template.csv" download>Download the template</a>.</p>
  <p class="muted small">Columns: ${IMPORT_COLUMNS.map(esc).join(', ')}. Only <strong>company</strong> is required. Empty cells stay empty: nothing is guessed. Companies already here are matched by domain, then name; people by email; existing records are not changed. A date in <em>last_contact_date</em> (yyyy-mm-dd) logs that contact as an action.</p>
  <p class="muted small">Enter only people you have a reason to keep in touch with, and only what they shared with you. In demo mode nothing is written anywhere.</p>
  <form id="import" class="open" autocomplete="off">
    <label>CSV file <input id="i-file" type="file" accept=".csv,text/csv"></label>
    <label>Or paste it <textarea id="i-text" rows="8" spellcheck="false"></textarea></label>
    <button type="submit">Show what will be written</button> <span id="form-error" class="warn"></span>
  </form>`;
}

function editLeadForm(c) {
  if (!canEdit()) return '';
  return `<details class="add"><summary>Edit stage, owner and next step</summary><form id="edit-lead" data-org="${esc(c.org)}" class="open" autocomplete="off">
    <label>Stage <select id="l-stage">${V.stages.map((s) => `<option value="${esc(s.id)}"${s.id === c.stage ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <label>Owner <input id="l-owner" value="${esc(c.owner || me())}" required></label>
    <label>Next step <input id="l-next" value="${esc(c.next_step || '')}"></label>
    <label>Due <input id="l-due" type="date" value="${esc(c.next_step_due || '')}"></label>
    <button type="submit">Show what will be written</button> <span id="form-error" class="warn"></span></form></details>`;
}
function logActionForm(c) {
  if (!canEdit()) return '';
  return `<details class="add" open><summary>Log an action</summary><form id="log-action" data-org="${esc(c.org)}" class="open inline" autocomplete="off">
    <label>What <select id="a-kind">${ACTION_KINDS.map((k) => `<option>${k}</option>`).join('')}</select></label>
    <label>Which way <select id="a-dir"><option value="out">We reached out</option><option value="in">They replied</option><option value="none">A note</option></select></label>
    <label>When <input id="a-at" type="date" value="${today()}" required></label>
    <label>Who <select id="a-person"><option value="">(the company)</option>${c.contacts.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>
    <label class="wide">What happened <input id="a-sum" required placeholder="for example: sent a LinkedIn note after the summit"></label>
    <button type="submit">Show what will be written</button> <span id="form-error" class="warn"></span></form></details>`;
}

// A person's key: the mark (checked after the page is drawn, see checkKeys) and, for a vault that can be written to,
// a place to drop or paste the QR code or key text they sent. The record is signed with this browser's key.
const short = (fp) => String(fp || '').replace('sha256:', '').slice(0, 8);
function keyMark(p) {
  const k = personKey(V, p.id);
  const mark = k ? `<span class="badge key" data-keycheck="${esc(p.id)}" title="${esc(k.fp)}">Key ${esc(short(k.fp))}: checking…</span>` : '<span class="badge key-none">No key yet</span>';
  if (!canEdit()) return mark;
  return `${mark} <details class="add inline"><summary>${k ? 'Change their key' : 'Add their key'}</summary><form class="open add-key" data-person="${esc(p.id)}" autocomplete="off">
    <p class="small">Drop or paste the QR code ${esc(p.first || p.name)} sent you from the You page, or paste its key text. Only add a key you got from them directly.</p>
    <label class="small">Their QR code picture <input type="file" accept="image/*" data-keyfile="${esc(p.id)}"></label>
    <label class="small">or its text <textarea rows="2" spellcheck="false" data-keytext="${esc(p.id)}"></textarea></label>
    <label class="small">How it reached you <select data-keyhow="${esc(p.id)}"><option value="qr">their QR code</option><option value="text">their key text</option></select></label>
    <button type="submit" class="small">Check it and show what will be written</button> <span class="warn" data-keyerr="${esc(p.id)}"></span></form></details>`;
}
async function checkKeys() {
  for (const el of document.querySelectorAll('[data-keycheck]')) {
    const k = personKey(V, el.dataset.keycheck); if (!k) continue;
    const r = await ME.checkKeyRecord(k);
    if (r.ok && (r.mine || r.trusted)) { el.textContent = `Verified key ✓ ${short(k.fp)}`; el.className = 'badge key-ok'; el.title = `${k.fp}, verified by ${r.mine ? 'you' : k.verified_by} on ${k.verified_at.slice(0, 10)}, from their ${k.how === 'qr' ? 'QR code' : 'key text'}`; }
    else if (r.ok) { el.textContent = `Key ${short(k.fp)}, signed by ${k.verified_by}`; el.className = 'badge key-other'; el.title = `${k.fp}. Signed by ${k.verifier_fp}, a key this browser does not know: check with ${k.verified_by}.`; }
    else { el.textContent = `Key ${short(k.fp)} does not check`; el.className = 'badge key-bad'; el.title = r.why; }
  }
}

function addPersonForm(org) {
  if (!canEdit()) return '';
  return `<details class="add"><summary>Add a person</summary><form id="add-person" data-org="${esc(org)}" class="open" autocomplete="off">
    <label>Name <input id="p-name" required></label>
    <label>Email <input id="p-email" type="email" required></label>
    <label>Role <span class="muted">(optional)</span> <input id="p-role"></label>
    <button type="submit">Show what will be written</button> <span id="form-error" class="warn"></span></form></details>`;
}

// A QR picture's text: the browser's BarcodeDetector where there is one, else jsQR (vendored, from the Email Cell).
async function qrFromPicture(file) {
  const bmp = await createImageBitmap(file); let t = null;
  if ('BarcodeDetector' in window) { try { const c = await new BarcodeDetector({ formats: ['qr_code'] }).detect(bmp); if (c.length) t = c[0].rawValue; } catch {} }
  // jsQR on a white margin, at the picture's size (at most 2000 px), then, for a small picture, at twice its size
  // with sharp edges: a QR code straight from this page is small and jsQR misses its fine modules.
  const big = Math.max(bmp.width, bmp.height), scales = [Math.min(1, 2000 / big), ...(big < 1000 ? [2] : [])];
  for (const k of scales) { if (t || !window.jsQR) break;
    const pad = 48, cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k) + 2 * pad; cv.height = Math.round(bmp.height * k) + 2 * pad;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.imageSmoothingEnabled = k < 1; cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(bmp, pad, pad, cv.width - 2 * pad, cv.height - 2 * pad);
    const r = window.jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height); if (r) t = r.data; }
  if (!t) throw new Error('no QR code found in that picture: try a sharper picture, or paste its text');
  return t;
}

function wireActions() {
  $('#login')?.addEventListener('submit', async (ev) => { ev.preventDefault(); const n = $('#li-name').value.trim(); if (!n) return; setMyName(n); showName(); $('#form-error').textContent = 'Making this browser\'s key (a few seconds)…'; try { await ME.logIn(n); await route(); $('#copyqr')?.click(); } catch (e) { $('#form-error').textContent = 'Not logged in: ' + e.message; } });
  const copied = (t) => { const el = $('#copy-status'); if (el) el.textContent = t; };
  $('#copykey')?.addEventListener('click', async () => { $('#mykey').select(); try { await navigator.clipboard.writeText($('#mykey').value); copied('Key text copied: paste it into WhatsApp.'); } catch { copied('Select the text and copy it.'); } });
  $('#copyqr')?.addEventListener('click', async () => {
    try { const [head, data] = $('img.qr').src.split(','), type = (head.match(/data:([^;]+)/) || [])[1] || 'image/gif'; const bin = atob(data), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const png = await new Promise((ok, no) => { const img = new Image(); img.onload = () => { const m = 48, c = document.createElement('canvas'); c.width = img.width * 2 + 2 * m; c.height = img.height * 2 + 2 * m; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, m, m, img.width * 2, img.height * 2); c.toBlob((b) => (b ? ok(b) : no(new Error('no image'))), 'image/png'); }; img.onerror = () => no(new Error('no image')); img.src = URL.createObjectURL(new Blob([bytes], { type })); }); const blob = png; await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]); copied('QR image copied: paste it into WhatsApp.'); }
    catch { copied('This browser could not copy the picture: right-click it and choose Copy image, or use Copy key text.'); } });
  const openCode = async (text) => { const st = $('#rc-status');
    try { st.className = 'muted'; st.textContent = 'Opening…'; const r = await ME.receive(text, async (key) => JSON.parse((await readAll(await openVault(key)))['manifest.json'] || '{}').name);
      if (!r.added.length) { st.className = 'warn'; st.textContent = `From ${r.from}, but there was no vault key in it.`; return; }
      JUST_ADDED = { vaults: r.added, from: r.from, note: r.note, token: r.token }; route();
    } catch (e) { st.className = 'warn'; st.textContent = 'Not opened: ' + e.message; } };
  const fromPicture = async (file) => { const st = $('#rc-status');
    try { st.className = 'muted'; st.textContent = 'Reading the QR code…'; await openCode(await qrFromPicture(file));
    } catch (e) { st.className = 'warn'; st.textContent = 'Not opened: ' + e.message; } };
  $('#receive')?.addEventListener('submit', (ev) => { ev.preventDefault(); openCode($('#rc-text').value); });
  $('#qrfile')?.addEventListener('change', (ev) => { const f = ev.target.files[0]; if (f) fromPicture(f); ev.target.value = ''; });
  const drop = $('#drop');
  if (drop) {
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/')); if (f) fromPicture(f); else { const t = e.dataTransfer?.getData('text'); if (t) openCode(t); } });
    drop.addEventListener('click', () => $('#qrfile').click());
  }
  if (!window.__crmPaste) { window.__crmPaste = true; document.addEventListener('paste', (e) => { if (!location.hash.startsWith('#/me') || !$('#drop')) return; if (e.target.closest && e.target.closest('textarea, input')) return;
    const f = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).find((x) => x && x.type.startsWith('image/'));
    if (f) { e.preventDefault(); fromPicture(f); return; } const t = e.clipboardData?.getData('text'); if (t && /pki\.sgit\.ai|m1\./.test(t)) { e.preventDefault(); openCode(t); } }); }
  for (const b of document.querySelectorAll('[data-openv]')) b.addEventListener('click', async () => { const st = (t, bad) => { $('#v-status').textContent = t; $('#v-status').className = bad ? 'warn' : 'muted'; };
    try { const key = await ME.vaultKey(b.dataset.openv); await loadVault(key, null, false, st, await ME.savedToken()); ME.setLastVault(b.dataset.openv); location.hash = '#/today'; route(); } catch (e) { st('Could not open: ' + e.message, true); } });
  for (const b of document.querySelectorAll('[data-vaultapp]')) b.addEventListener('click', async () => {
    // The vault app takes the key after '#', which a browser never sends to a server. Opened in a new tab, without an opener.
    try { const key = await ME.vaultKey(b.dataset.vaultapp); const bare = String(key).replace(/^sgit_private_vault_/, ''); window.open(`https://dev.vault.sgraph.ai/en-gb/#${bare}`, '_blank', 'noopener'); }
    catch (e) { $('#v-status').textContent = 'Could not open: ' + e.message; } });
  for (const b of document.querySelectorAll('[data-forgetv]')) b.addEventListener('click', async () => { if (confirm('Forget this vault in this browser? The vault itself is not touched.')) { await ME.forgetVault(b.dataset.forgetv); route(); } });
  $('#logout')?.addEventListener('click', async () => { if (confirm('Log out of this browser? The vault keys kept here are removed.')) { await ME.logOut(); await loadDemo(); location.hash = '#/me'; route(); } });
  $('#i-file')?.addEventListener('change', async (ev) => { const f = ev.target.files[0]; if (f) $('#i-text').value = await f.text(); });
  $('#import')?.addEventListener('submit', (ev) => { ev.preventDefault(); if (!me()) return askName(); ask('Import these?', () => {
    const { files, report } = importFiles(V, $('#i-text').value, { by: me(), at: nowIso() });
    const note = `${report.orgs} new companies (each with its lead row), ${report.people} new people, ${report.actions} contacts logged as actions.` + (report.skipped.length ? ` Skipped ${report.skipped.length}: ${report.skipped.join('; ')}.` : '') + (report.unknown_columns.length ? ` Columns ignored: ${report.unknown_columns.join(', ')}.` : '');
    return { files, note };
  }); });
  $('#log-action')?.addEventListener('submit', (ev) => { ev.preventDefault(); if (!me()) return askName(); ask('Log this action?', () => actionFile(V, { id: newId('a'), org: ev.target.dataset.org, person: $('#a-person').value || null, kind: $('#a-kind').value, direction: $('#a-dir').value, at: $('#a-at').value, by: me(), summary: $('#a-sum').value, logged_at: nowIso() })); });
  $('#edit-lead')?.addEventListener('submit', (ev) => { ev.preventDefault(); ask('Change this lead?', () => leadEditFile(V, ev.target.dataset.org, { stage: $('#l-stage').value, owner: $('#l-owner').value.trim(), next_step: $('#l-next').value.trim(), next_step_due: $('#l-due').value, at: nowIso() })); });
  $('#add-org')?.addEventListener('submit', (ev) => { ev.preventDefault(); ask('Add this company?', () => companyFiles(V, { id: newId('o'), name: $('#o-name').value, domain: $('#o-domain').value, kind: $('#o-kind').value, next_step: $('#o-next').value.trim(), owner: me(), at: nowIso() })); });
  checkKeys();
  // Each .grid cell carries its column's heading as data-label: on a phone the table stacks and the label prints first.
  for (const t of document.querySelectorAll('table.grid')) { const heads = [...t.querySelectorAll('thead th')].map((h) => h.textContent.trim());
    for (const tr of t.querySelectorAll('tbody tr')) [...tr.children].forEach((td, i) => { if (heads[i] && !td.hasAttribute('colspan')) td.dataset.label = heads[i]; }); }
  for (const f of document.querySelectorAll('[data-keyfile]')) f.addEventListener('change', async (ev) => { const file = ev.target.files[0], pid = f.dataset.keyfile; if (!file) return;
    try { $(`[data-keytext="${pid}"]`).value = await qrFromPicture(file); $(`[data-keyhow="${pid}"]`).value = 'qr'; } catch (e) { $(`[data-keyerr="${pid}"]`).textContent = e.message; } });
  for (const form of document.querySelectorAll('form.add-key')) form.addEventListener('submit', async (ev) => { ev.preventDefault(); const pid = form.dataset.person, err = $(`[data-keyerr="${pid}"]`);
    if (!me()) return askName();
    try { err.className = 'muted'; err.textContent = 'Checking…'; const got = await ME.readTheirKey($(`[data-keytext="${pid}"]`).value), mine = await ME.myVerifier();
      if (!mine) throw new Error('log in first, on the You page: the key is signed for with your own');
      const rec = await ME.signKeyRecord(keyRecord(V, { person: pid, ...got, how: $(`[data-keyhow="${pid}"]`).value, verified_by: me(), verified_at: nowIso(), ...mine }));
      ask(`Record ${V.people.find((p) => p.id === pid)?.name}'s key?`, () => ({ files: [keyFile(rec)], note: `Key ${rec.fp}${rec.label ? ` (${rec.label})` : ''}, signed for by you (${rec.verifier_fp}).` }));
    } catch (e) { err.className = 'warn'; err.textContent = 'Not added: ' + e.message; } });
  $('#add-person')?.addEventListener('submit', (ev) => { ev.preventDefault(); ask('Add this person?', () => personFile(V, { id: newId('p'), name: $('#p-name').value, email: $('#p-email').value, role: $('#p-role').value, org: ev.target.dataset.org, by: me(), at: nowIso() })); });
  $('#nk-copy')?.addEventListener('click', () => { $('#nk').select(); navigator.clipboard?.writeText($('#nk').value).catch(() => {}); });
  $('#nk-done')?.addEventListener('click', () => { NEWKEY = null; route(); });
  for (const b of document.querySelectorAll('[data-link]')) b.addEventListener('click', () => {
    const org = b.dataset.pick ? document.querySelector(`select[data-for="${b.dataset.link}"]`).value : b.dataset.org;
    const person = V.people.find((x) => x.id === b.dataset.person)?.org === org ? b.dataset.person : null;
    askLink(b.dataset.link, org, person);
  });
  for (const b of document.querySelectorAll('[data-unlink]')) b.addEventListener('click', () => askUnlink(b.dataset.unlink));
  $('#w-go')?.addEventListener('click', doPending);
  $('#w-cancel')?.addEventListener('click', () => { PENDING = null; route(); });
}

async function route() {
  const [path, query] = (location.hash.slice(1) || '/today').split('?');
  const [, page, id] = path.split('/');
  const body = page === 'open' ? await openPage() : page === 'company' ? companyPage(id) : page === 'today' ? todayPage() : page === 'threads' ? threadsPage() : page === 'import' ? importPage() : page === 'me' ? await mePage() : page === 'follow-ups' ? followUpsPage() : page === 'contacts' ? contactsPage() : board();
  $('#main').innerHTML = newKeyPanel() + pendingPanel() + body;
  if (page === 'open') wireOpen();
  wireActions();
  if (PENDING) $('#pending')?.scrollIntoView();
  else if (page === 'company' && /(^|&)log=1/.test(query || '')) { $('#log-action')?.scrollIntoView(); $('#a-sum')?.focus(); }
  document.body.classList.remove('menu-open');
  for (const a of document.querySelectorAll('nav a')) a.classList.toggle('on', a.getAttribute('href') === `#/${page || 'today'}`);
}

$('#me')?.addEventListener('click', askName); showName();
$('#menu-toggle')?.addEventListener('click', () => document.body.classList.toggle('menu-open'));
$('#mode')?.addEventListener('click', () => { location.hash = '#/me'; });
loadDemo().then(async () => {
  addEventListener('hashchange', route);
  // Reopen the vault this browser last had open (asking for the passkey if there is one); the demo stays one press away.
  const last = ME.lastVault();
  if (last && await ME.loggedIn()) {
    const v = (await ME.vaults()).find((x) => x.id === last);
    if (v) { $('#banner').textContent = `Opening ${v.name}…`; try { await loadVault(await ME.vaultKey(last), null, false, () => {}, await ME.savedToken()); } catch (e) { await loadDemo(); $('#banner').textContent = `Could not reopen ${v.name} (${e.message}); showing the demo. Open it again from You.`; } }
  }
  route();
}).catch((e) => { $('#main').innerHTML = `<p class="warn">Could not load the demo: ${esc(e.message)}</p>`; });

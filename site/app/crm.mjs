// The CRM's model: the crm/ records it owns inside a demo twin or a real CRM vault, their checks, and
// what the lead board, a company's page and follow-ups show. Runs the same in Node and in the browser:
// no imports, input is a map of vault paths to file text.
// Layout read (shared demo twin, agreed with mail.dev.a@AgentiCCells.dinis, 23 Nov 2026):
//   orgs/<id>.json demo.org/1, people/<id>.json demo.person/1, drafts/<person>.json,
//   mail/ the Email Cell's twin format v1 (threads/, raw/messages/ or clean/messages/)
// Layout owned (a proposal until checked against the team CRM's shapes):
//   crm/stages.json             crm.stages/1   the pipeline's stages in order
//   crm/leads/<org-id>.json     crm.lead/1     one row per company: stage, owner, next step
//   crm/links/<thread-id>.json  crm.link/1     a mail thread tied to a company (and person)
// Draft state, last contact and follow-ups are derived, never stored.
// By crm.dev.a@AgentiCCells.dinis, 2026-11-23. Apache-2.0.

export const DAY = 864e5;
export const FOLLOW_UP_DAYS = 5;
export const STAGES = [
  { id: 'new', name: 'New' },
  { id: 'contacted', name: 'Contacted' },
  { id: 'talking', name: 'Talking' },
  { id: 'proposal', name: 'Proposal' },
  { id: 'won', name: 'Won' },
  { id: 'parked', name: 'Parked' },
];

const json = (t) => (typeof t === 'string' ? JSON.parse(t) : t);
const under = (files, prefix) => Object.keys(files).filter((p) => p.startsWith(prefix) && p.endsWith('.json')).sort().map((p) => json(files[p]));
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const DAYISO = /^\d{4}-\d{2}-\d{2}$/;

// Read a vault (paths to text, or to parsed objects) into records.
export function readVault(files) {
  const messages = new Map();
  for (const m of [...under(files, 'mail/raw/messages/'), ...under(files, 'mail/clean/messages/')]) if (!messages.has(m.id)) messages.set(m.id, m);
  return {
    manifest: files['manifest.json'] ? json(files['manifest.json']) : null,
    mailbox: files['mail/mailbox.json'] ? json(files['mail/mailbox.json']) : null,
    orgs: under(files, 'orgs/'),
    people: under(files, 'people/'),
    // drafts/: the twin's own drafts (any shape but v:1), the outbox drafts (v:1, the signed-batch format agreed with
    // mail.dev.a and a.mail.conductor, 24 Nov 2026) and their sign-offs (drafts/<id>.approved.json); sent/: what the cell sent.
    drafts: Object.keys(files).filter((p) => p.startsWith('drafts/') && p.endsWith('.json') && !p.endsWith('.approved.json')).sort().map((p) => json(files[p])).filter((d) => d.v !== 1),
    outbox: Object.keys(files).filter((p) => /^drafts\/[^/]+\.json$/.test(p) && !p.endsWith('.approved.json')).sort().map((p) => json(files[p])).filter((d) => d.v === 1),
    approvals: Object.keys(files).filter((p) => /^drafts\/[^/]+\.approved\.json$/.test(p)).sort().map((p) => json(files[p])),
    sent: under(files, 'sent/'),
    threads: under(files, 'mail/threads/'),
    messages,
    stages: files['crm/stages.json'] ? json(files['crm/stages.json']).stages : STAGES,
    leads: under(files, 'crm/leads/'),
    links: under(files, 'crm/links/'),
    actions: under(files, 'crm/actions/'),
    keys: under(files, 'crm/keys/'),
  };
}

// Check the crm/ records and their references to orgs, people and threads.
export function checkCrm(v) {
  const errors = [];
  const orgs = new Set(v.orgs.map((o) => o.id)), people = new Map(v.people.map((p) => [p.id, p])), threads = new Set(v.threads.map((t) => t.id));
  const stages = new Set(v.stages.map((s) => s.id));
  if (stages.size !== v.stages.length) errors.push('stages: duplicate id');
  const seen = new Set();
  for (const l of v.leads) {
    if (l.schema !== 'crm.lead/1') errors.push(`lead ${l.org}: schema is not crm.lead/1`);
    if (!orgs.has(l.org)) errors.push(`lead ${l.org}: no such org`);
    if (seen.has(l.org)) errors.push(`lead ${l.org}: duplicate`);
    seen.add(l.org);
    if (!stages.has(l.stage)) errors.push(`lead ${l.org}: unknown stage ${l.stage}`);
    if (typeof l.owner !== 'string' || !l.owner) errors.push(`lead ${l.org}: no owner`);
    if (l.next_step != null && typeof l.next_step !== 'string') errors.push(`lead ${l.org}: next_step is not text`);
    if (l.next_step_due != null && !DAYISO.test(l.next_step_due)) errors.push(`lead ${l.org}: next_step_due is not yyyy-mm-dd`);
    if (l.updated_at != null && !ISO.test(l.updated_at)) errors.push(`lead ${l.org}: updated_at is not an ISO time`);
  }
  for (const a of v.actions || []) {
    if (a.schema !== 'crm.action/1') errors.push(`action ${a.id}: schema is not crm.action/1`);
    if (!orgs.has(a.org)) errors.push(`action ${a.id}: no such org ${a.org}`);
    if (a.person != null && !people.has(a.person)) errors.push(`action ${a.id}: no such person ${a.person}`);
  }
  const keyFps = new Map();
  for (const k of v.keys || []) {
    if (k.schema !== 'crm.key/1') errors.push(`key ${k.person}: schema is not crm.key/1`);
    if (!people.has(k.person)) errors.push(`key ${k.person}: no such person`);
    if (!FPK.test(k.fp || '') || !K1.test(k.code || '')) errors.push(`key ${k.person}: not a key in its shape`);
    if (keyFps.has(k.fp)) errors.push(`key ${k.person}: the same key as ${keyFps.get(k.fp)}'s`);
    keyFps.set(k.fp, k.person);
  }
  for (const k of v.links) {
    if (k.schema !== 'crm.link/1') errors.push(`link ${k.thread}: schema is not crm.link/1`);
    if (!threads.has(k.thread)) errors.push(`link ${k.thread}: no such thread`);
    if (!orgs.has(k.org)) errors.push(`link ${k.thread}: no such org ${k.org}`);
    if (k.person != null) {
      const p = people.get(k.person);
      if (!p) errors.push(`link ${k.thread}: no such person ${k.person}`);
      else if (p.org !== k.org) errors.push(`link ${k.thread}: person ${k.person} is not at ${k.org}`);
    }
  }
  return errors;
}

// The thread's org: its link if there is one, else its person's org, else by the other party's domain.
export function threadOrg(v, t, idx = index(v)) {
  const link = idx.linkByThread.get(t.id);
  if (link) return { org: link.org, person: link.person ?? null, linked: true };
  const p = t.person && idx.person.get(t.person);
  if (p) return { org: p.org, person: p.id, linked: false };
  const me = v.mailbox?.address;
  for (const a of t.participants || []) {
    if (a === me) continue;
    const byMail = idx.personByEmail.get(a.toLowerCase());
    if (byMail) return { org: byMail.org, person: byMail.id, linked: false };
    const o = idx.orgByDomain.get(a.split('@')[1]?.toLowerCase());
    if (o) return { org: o.id, person: null, linked: false };
  }
  return null;
}

function index(v) {
  const idx = {
    person: new Map(v.people.map((p) => [p.id, p])),
    personByEmail: new Map(v.people.flatMap((p) => (p.emails || []).map((e) => [e.toLowerCase(), p]))),
    orgByDomain: new Map(v.orgs.filter((o) => o.domain).map((o) => [o.domain.toLowerCase(), o])),
    linkByThread: new Map(v.links.map((k) => [k.thread, k])),
  };
  return idx;
}

// The last message of a thread, by date.
export function lastMessage(v, t) {
  const list = (t.messages || []).map((id) => v.messages.get(id)).filter(Boolean);
  return list.sort((a, b) => Date.parse(a.date) - Date.parse(b.date)).at(-1) || null;
}

// Threads whose last message is ours and has had no reply for `days` or more, oldest wait first.
export function followUps(v, now, days = FOLLOW_UP_DAYS) {
  const idx = index(v), out = [];
  // The latest logged contact per company (a note does not count). A mail thread that waits on a reply stops counting
  // once anything was logged for that company at or after its last email: a reply clears it, and our own new
  // reaching out restarts the clock below (found by a.crm.studio, 24 Nov 2026).
  const latestAction = new Map();
  for (const a of v.actions || []) { if (a.direction === 'none') continue; const t = actionTime(a); if (!latestAction.has(a.org) || t > latestAction.get(a.org)) latestAction.set(a.org, t); }
  for (const t of v.threads) {
    const m = lastMessage(v, t);
    if (!m || m.direction !== 'outbound') continue;
    const waited = Math.floor((now - Date.parse(m.date)) / DAY);
    if (waited < days) continue;
    const who = threadOrg(v, t, idx);
    if (who?.org && latestAction.has(who.org) && latestAction.get(who.org) >= Date.parse(m.date)) continue;
    out.push({ thread: t.id, subject: t.subject, sent: m.date, days: waited, org: who?.org ?? null, person: who?.person ?? null });
  }
  // Logged actions: a company whose latest contact (logged or mail) is us reaching out, 'days' or more ago.
  for (const o of v.orgs) {
    const last = timeline(v, o.id).find((e) => e.direction !== 'none');
    if (!last || last.type !== 'action' || last.direction !== 'out') continue;
    const waited = Math.floor((now - last.time) / DAY);
    if (waited < days) continue;
    out.push({ thread: null, action: last.id, subject: `${last.kind}: ${last.summary}`, sent: last.at, days: waited, org: o.id, person: last.person });
  }
  return out.sort((a, b) => b.days - a.days || String(a.thread || a.action).localeCompare(String(b.thread || b.action)));
}

// Draft state of a company: from drafts/ for its people. 'draft' if any waits, else 'sent' if any was sent, else 'none'.
export function draftState(v, orgId) {
  const ds = v.drafts.filter((d) => (d.org ?? v.people.find((p) => p.id === d.person)?.org) === orgId);
  // A draft still waiting is what needs doing, so it wins over one already sent (design review round 1: the board said
  // "Sent" while the company page showed a draft waiting).
  if (ds.some((d) => d.status === 'draft' || d.status === 'approved')) return { state: 'draft', count: ds.length };
  if (ds.some((d) => d.status === 'sent')) return { state: 'sent', count: ds.length };
  return { state: 'none', count: ds.length };
}

// The lead board: one row per company, in stage order then name.
export function leadBoard(v, now) {
  const idx = index(v);
  const lead = new Map(v.leads.map((l) => [l.org, l]));
  const last = new Map(), threads = new Map();
  for (const t of v.threads) {
    const who = threadOrg(v, t, idx);
    if (!who) continue;
    threads.set(who.org, (threads.get(who.org) || 0) + 1);
    const m = lastMessage(v, t);
    if (m && (!last.has(who.org) || Date.parse(m.date) > Date.parse(last.get(who.org).date))) last.set(who.org, { date: m.date, direction: m.direction, thread: t.id });
  }
  for (const a of v.actions || []) {
    if (a.direction === 'none') continue;
    const t = actionTime(a), cur = last.get(a.org);
    if (!cur || t > Date.parse(cur.date)) last.set(a.org, { date: new Date(t).toISOString().replace(/\.\d+Z$/, 'Z'), direction: a.direction === 'out' ? 'outbound' : 'inbound', action: a.id, kind: a.kind });
  }
  const waiting = new Map();
  // Threads at this company still waiting on a reply: how many, and the longest wait (followUps is
  // sorted longest first).
  for (const f of followUps(v, now)) {
    if (!f.org) continue;
    const w = waiting.get(f.org);
    if (w) w.count++; else waiting.set(f.org, { count: 1, days: f.days, thread: f.thread });
  }
  const order = new Map(v.stages.map((s, i) => [s.id, i]));
  return v.orgs.map((o) => {
    const l = lead.get(o.id) || {};
    return {
      org: o.id, name: o.name, domain: o.domain, kind: o.kind,
      stage: l.stage || 'new', owner: l.owner || null,
      draft: draftState(v, o.id),
      last_contact: last.get(o.id) || null,
      threads: threads.get(o.id) || 0,
      people: v.people.filter((p) => p.org === o.id).length,
      next_step: l.next_step || null, next_step_due: l.next_step_due || null,
      overdue: !!(l.next_step_due && Date.parse(l.next_step_due + 'T23:59:59Z') < now),
      waiting: waiting.get(o.id) || null,
      synthetic: !!(o.synthetic || l.synthetic),
    };
  }).sort((a, b) => (order.get(a.stage) ?? 99) - (order.get(b.stage) ?? 99) || a.name.localeCompare(b.name));
}

// A company's page: the board row, its people, its threads (newest first) and its drafts.
export function company(v, orgId, now) {
  const idx = index(v);
  const row = leadBoard(v, now).find((r) => r.org === orgId);
  if (!row) return null;
  const threads = v.threads.filter((t) => threadOrg(v, t, idx)?.org === orgId).map((t) => {
    const m = lastMessage(v, t);
    return { id: t.id, subject: t.subject, last_date: m?.date || t.last_date, direction: m?.direction || null, person: threadOrg(v, t, idx).person, linked: idx.linkByThread.has(t.id) };
  }).sort((a, b) => Date.parse(b.last_date) - Date.parse(a.last_date));
  return { ...row, lead: v.leads.find((l) => l.org === orgId) || null, contacts: v.people.filter((p) => p.org === orgId), threads, drafts: v.drafts.filter((d) => (d.org ?? idx.person.get(d.person)?.org) === orgId) };
}

// The contacts list: one row per person, with their company and last contact.
export function contacts(v) {
  const orgName = new Map(v.orgs.map((o) => [o.id, o.name]));
  return v.people.map((p) => {
    const mine = v.threads.filter((t) => t.person === p.id || (t.participants || []).some((a) => (p.emails || []).includes(a)));
    const dates = mine.map((t) => lastMessage(v, t)?.date || t.last_date).sort();
    return { id: p.id, name: p.name, email: (p.emails || [])[0] || null, type: p.type || null, twin: p.twin || null, role: p.role || null, org: p.org, org_name: orgName.get(p.org) || null, key_fp: (v.keys || []).find((k) => k.person === p.id)?.fp || null, threads: mine.length, last_contact: dates.at(-1) || null };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// Threads with no crm/links/ record, newest first, with the company they are matched to (if any).
export function unlinkedThreads(v) {
  const idx = index(v);
  return v.threads.filter((t) => !idx.linkByThread.has(t.id)).map((t) => {
    const m = lastMessage(v, t), who = threadOrg(v, t, idx);
    return { id: t.id, subject: t.subject, last_date: m?.date || t.last_date, org: who?.org ?? null, person: who?.person ?? null };
  }).sort((a, b) => Date.parse(b.last_date) - Date.parse(a.last_date));
}

// The exact file a hand-made link writes: { path, record, text }. Throws if it would not check out.
export function linkFile(v, { thread, org, person = null, by, at }) {
  const record = { schema: 'crm.link/1', thread, org, ...(person ? { person } : {}), linked_by: by, linked_at: at };
  const probe = { ...v, links: [...v.links.filter((k) => k.thread !== thread), record] };
  const errors = checkCrm(probe).filter((e) => e.startsWith(`link ${thread}:`));
  if (errors.length) throw new Error(errors.join('; '));
  if (!by || typeof by !== 'string') throw new Error('a link needs the name of who made it');
  if (!ISO.test(at || '')) throw new Error('a link needs its time, as an ISO time');
  return { path: `crm/links/${thread}.json`, record, text: JSON.stringify(record, null, 2) + '\n' };
}

// Companies and people a person adds by hand, in their own CRM vault. The fields are the shared demo
// twin's (demo.org/1, demo.person/1, agreed with mail.dev.a), under the CRM's own schema names, so a
// reader of one reads the other. Ids are random, so two devices adding at once do not collide.
export const KINDS = ['prospect', 'customer', 'investor', 'partner', 'event', 'community', 'other'];
const EMAIL = /^[^\s@<>"]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
export const newId = (prefix, rand = () => crypto.getRandomValues(new Uint8Array(4))) =>
  prefix + '-' + Array.from(rand(), (b) => b.toString(16).padStart(2, '0')).join('');

// A new company and its lead row: two files, written together. Throws with a plain reason.
export function companyFiles(v, { id, name, domain = '', kind = 'prospect', owner, at, stage = 'new', next_step = '' }) {
  name = String(name || '').trim(); domain = String(domain || '').trim().toLowerCase();
  if (!name) throw new Error('a company needs a name');
  if (domain && !DOMAIN.test(domain)) throw new Error(`"${domain}" is not a domain (like example.com)`);
  if (domain && v.orgs.some((o) => (o.domain || '').toLowerCase() === domain)) throw new Error(`a company with domain ${domain} is already here`);
  if (v.orgs.some((o) => o.name.toLowerCase() === name.toLowerCase())) throw new Error(`"${name}" is already here`);
  if (!KINDS.includes(kind)) throw new Error(`unknown kind ${kind}`);
  if (!owner) throw new Error('a lead needs an owner');
  if (!ISO.test(at || '')) throw new Error('needs the time, as an ISO time');
  const org = { schema: 'crm.org/1', id, name, ...(domain ? { domain } : {}), kind, added_by: owner, added_at: at };
  const lead = { schema: 'crm.lead/1', org: id, stage, owner, ...(next_step ? { next_step } : {}), updated_at: at };
  return [
    { path: `orgs/${id}.json`, record: org, text: JSON.stringify(org, null, 2) + '\n' },
    { path: `crm/leads/${id}.json`, record: lead, text: JSON.stringify(lead, null, 2) + '\n' },
  ];
}

// A new person at a company: one file.
// met: where we met them, in a few words (a.crm.design, round 2 asks: 'the person on each card, and where we met').
// Who a person is (Dinis Cruz, 25 Nov 2026: "start with us (the team), some of our agents and some synthetic users ... to
// iron out the workflows"): 'team', 'agent' or 'synthetic'; none for an ordinary contact. twin is the address of their
// digital twin inbox (the Email Cell's simulated Gmail), where one is set. A team member may have no email yet: they add
// their own. A synthetic person is made up, on the reserved example domains only.
export const PERSON_TYPES = ['team', 'agent', 'synthetic'];
const RESERVED = /@(?:[a-z0-9-]+\.)*example\.(?:com|net|org)$|\.invalid$/i;
export function personFile(v, { id, name, email, org, role = '', met = '', type = '', twin = '', by, at }) {
  name = String(name || '').trim(); email = String(email || '').trim().toLowerCase(); type = String(type || '').trim().toLowerCase(); twin = String(twin || '').trim().toLowerCase();
  if (!name) throw new Error('a person needs a name');
  if (type && !PERSON_TYPES.includes(type)) throw new Error(`unknown type ${type} (team, agent or synthetic)`);
  if (!(type === 'team' && !email) && !EMAIL.test(email)) throw new Error(`"${email}" is not an email address`);
  if (type === 'synthetic' && !RESERVED.test(email)) throw new Error(`a synthetic person's email must be on example.com, example.net, example.org or .invalid`);
  if (twin && !(EMAIL.test(twin) && RESERVED.test(twin))) throw new Error(`a twin inbox must be on a reserved example domain`);
  if (!v.orgs.some((o) => o.id === org)) throw new Error(`no such company ${org}`);
  if (email && v.people.some((p) => (p.emails || []).map((e) => e.toLowerCase()).includes(email))) throw new Error(`${email} is already here`);
  if (!ISO.test(at || '')) throw new Error('needs the time, as an ISO time');
  const first = name.split(/\s+/)[0];
  const person = { schema: 'crm.person/1', id, name, first, emails: email ? [email] : [], org, ...(type ? { type } : {}), ...(twin ? { twin } : {}), ...(role ? { role: String(role).trim() } : {}), ...(String(met || '').trim() ? { met: String(met).trim().slice(0, 120) } : {}), added_by: by, added_at: at };
  return [{ path: `people/${id}.json`, record: person, text: JSON.stringify(person, null, 2) + '\n' }];
}

// A new CRM vault's first files: its manifest (which marks it as a CRM vault the page may write to)
// and the stages.
export function newVaultFiles({ owner, at, name = '' }) {
  if (!owner) throw new Error('a CRM vault needs an owner name');
  const manifest = { schema: 'crm.vault/1', synthetic: false, ...(name ? { name } : {}), owner, created_at: at, created_by: 'CRM tool site (crm.tool.sovereignweb.site)', twin: null };
  return [
    { path: 'manifest.json', text: JSON.stringify(manifest, null, 2) + '\n' },
    { path: 'crm/stages.json', text: JSON.stringify({ schema: 'crm.stages/1', stages: STAGES }, null, 2) + '\n' },
  ];
}

// Verified keys (Dinis Cruz, 24 Nov 2026: "When I give you a QR code, you should be actually connecting that QR code
// with the person ... each contact ... should then have a QR code that we have verified"). crm/keys/<person-id>.json,
// crm.key/1: { person, code (their pki.sgit.ai k1 key code), fp (its signing fingerprint), enc_fp, label, how ('qr' or
// 'text', how it reached us), verified_by (a name), verified_at, verifier (the verifier's own k1 code), verifier_fp, sig }.
// sig is the verifier's ECDSA P-256 signature (base64, P1363) over the record without sig, in pki.sgit.ai's canonical
// statement form (keys.js canonicalBytes). The model checks the shape; the page checks the keys and the signature.
// One record per person: a new key replaces the old one, and the vault's history keeps the old.
const FPK = /^sha256:[0-9a-f]{16}$/, K1 = /^k1\.[A-Za-z0-9_-]{100,1200}\.[A-Za-z0-9_-]{60,200}\.[A-Za-z0-9_-]{0,200}$/;
export function keyRecord(v, { person, code, fp, enc_fp, label = '', how, verified_by, verified_at, verifier, verifier_fp }) {
  if (!v.people.some((p) => p.id === person)) throw new Error(`no such person ${person}`);
  if (!K1.test(code || '')) throw new Error('not a pki.sgit.ai key code');
  if (!FPK.test(fp || '') || !FPK.test(enc_fp || '')) throw new Error('a key needs both its fingerprints');
  if (!['qr', 'text'].includes(how)) throw new Error('how the key came must be qr or text');
  if (!verified_by) throw new Error('a verified key needs the name of who verified it');
  if (!ISO.test(verified_at || '')) throw new Error('needs the time, as an ISO time');
  if (!K1.test(verifier || '') || !FPK.test(verifier_fp || '')) throw new Error('needs the verifier\'s own key: log in on the You page');
  if (verifier_fp === fp) throw new Error('that is your own key');
  const other = (v.keys || []).find((k) => k.fp === fp && k.person !== person);
  if (other) throw new Error(`that key is already ${v.people.find((p) => p.id === other.person)?.name || other.person}'s`);
  return { schema: 'crm.key/1', person, code, fp, enc_fp, label: String(label).slice(0, 80), how, verified_by, verified_at, verifier, verifier_fp };
}
export const keyFile = (record) => ({ path: `crm/keys/${record.person}.json`, record, text: JSON.stringify(record, null, 2) + '\n' });
export const personKey = (v, person) => (v.keys || []).find((k) => k.person === person) || null;

// Actions: each thing the team does with a contact, logged by hand (Dinis, 24 Nov 2026: the team needs "a centralised
// place to put each contact and each action taken with them"). crm/actions/<id>.json, crm.action/1:
// { id, org, person?, kind, direction: 'out' | 'in' | 'none', at (yyyy-mm-dd or ISO time), by, summary, logged_at }.
// 'out' is us reaching out, 'in' is them answering, 'none' is a note or an internal step.
export const ACTION_KINDS = ['email', 'linkedin', 'call', 'meeting', 'message', 'note'];
const DAYISH = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/;
const actionTime = (a) => Date.parse(a.at.length === 10 ? a.at + 'T12:00:00Z' : a.at);

export function actionFile(v, { id, org, person = null, kind, direction, at, by, summary, logged_at, simulated = false }) {
  summary = String(summary || '').trim();
  if (!v.orgs.some((o) => o.id === org)) throw new Error(`no such company ${org}`);
  if (person && v.people.find((p) => p.id === person)?.org !== org) throw new Error(`that person is not at this company`);
  if (!ACTION_KINDS.includes(kind)) throw new Error(`unknown kind ${kind}`);
  if (!['out', 'in', 'none'].includes(direction)) throw new Error(`unknown direction ${direction}`);
  if (!DAYISH.test(at || '')) throw new Error('the date must be yyyy-mm-dd');
  if (!by) throw new Error('set your name first (top right)');
  if (!summary) throw new Error('say in a few words what happened');
  if (!ISO.test(logged_at || '')) throw new Error('needs the time, as an ISO time');
  if (simulated && v.people.find((p) => p.id === person)?.type !== 'synthetic') throw new Error('only a synthetic person can have a simulated action');
  const a = { schema: 'crm.action/1', id, org, ...(person ? { person } : {}), kind, direction, at, by, summary, logged_at, ...(simulated ? { simulated: true } : {}) };
  return [{ path: `crm/actions/${id}.json`, record: a, text: JSON.stringify(a, null, 2) + '\n' }];
}

// A lead row changed by hand: stage, owner, next step and its date. Returns the one file to write.
export function leadEditFile(v, org, { stage, owner, next_step = '', next_step_due = '', at }) {
  if (!v.orgs.some((o) => o.id === org)) throw new Error(`no such company ${org}`);
  if (!v.stages.some((s) => s.id === stage)) throw new Error(`unknown stage ${stage}`);
  if (!owner) throw new Error('a lead needs an owner');
  if (next_step_due && !/^\d{4}-\d{2}-\d{2}$/.test(next_step_due)) throw new Error('the due date must be yyyy-mm-dd');
  if (!ISO.test(at || '')) throw new Error('needs the time, as an ISO time');
  const old = v.leads.find((l) => l.org === org) || {};
  const lead = { ...old, schema: 'crm.lead/1', org, stage, owner, updated_at: at };
  if (next_step) lead.next_step = next_step; else delete lead.next_step;
  if (next_step_due) lead.next_step_due = next_step_due; else delete lead.next_step_due;
  return [{ path: `crm/leads/${org}.json`, record: lead, text: JSON.stringify(lead, null, 2) + '\n' }];
}

// Everything that happened with a company, newest first: logged actions and mail, in one list.
export function timeline(v, org) {
  const idx = index(v);
  const acts = (v.actions || []).filter((a) => a.org === org).map((a) => ({ type: 'action', at: a.at, time: actionTime(a), kind: a.kind, direction: a.direction, by: a.by, person: a.person || null, summary: a.summary, id: a.id }));
  const mail = v.threads.filter((t) => threadOrg(v, t, idx)?.org === org).map((t) => { const m = lastMessage(v, t); return m && { type: 'mail', at: m.date, time: Date.parse(m.date), kind: 'email', direction: m.direction === 'outbound' ? 'out' : 'in', person: threadOrg(v, t, idx).person, summary: t.subject, id: t.id }; }).filter(Boolean);
  const byId = new Map((v.outbox || []).map((d) => [d.id, d]));
  const sent = (v.sent || []).map((r) => ({ r, d: byId.get(r.draft_id) })).filter(({ d }) => d && d.crm?.org === org)
    .map(({ r, d }) => ({ type: 'sent', at: r.sent_at, time: Date.parse(r.sent_at), kind: 'email', direction: 'out', person: d.crm.person || null, summary: d.subject + (r.simulation ? ' (simulated send)' : ''), id: d.id }));
  return [...acts, ...mail, ...sent].sort((a, b) => b.time - a.time);
}

// The outbox: drafts in the signed-batch format, each with its latest sign-off and its send, if any.
// state: 'draft' (not signed off), 'approved' (signed off, not sent) or 'sent'.
export function outbox(v, org = null) {
  return (v.outbox || []).filter((d) => !org || d.crm?.org === org).map((d) => {
    const approved = (v.approvals || []).filter((a) => a.draft_id === d.id).sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at)))[0] || null;
    const sent = (v.sent || []).find((r) => r.draft_id === d.id) || null;
    return { draft: d, approved, sent, state: sent ? 'sent' : approved ? 'approved' : 'draft' };
  }).sort((a, b) => String(b.draft.created_at).localeCompare(String(a.draft.created_at)));
}

// A new outbox draft for one person: drafts/<id>.json, v:1. One To address, no Cc, no Bcc; attachments come later.
export function outboxDraftFile(v, { id, org, person, subject, text, in_reply_to = '', send_after = '', created_at, created_by }) {
  subject = String(subject || '').trim(); text = String(text || '');
  const p = v.people.find((x) => x.id === person);
  if (!v.orgs.some((o) => o.id === org)) throw new Error(`no such company ${org}`);
  if (!p || p.org !== org) throw new Error('choose a person at this company');
  const to = (p.emails || [])[0];
  if (!to || !EMAIL.test(to)) throw new Error(`${p.name} has no email address`);
  if (!subject) throw new Error('an email needs a subject');
  if (!text.trim()) throw new Error('an email needs some text');
  if (send_after && !ISO.test(send_after)) throw new Error('send after must be an ISO time');
  if (!ISO.test(created_at || '')) throw new Error('needs the time, as an ISO time');
  if (!created_by) throw new Error('set your name first (top right)');
  const d = { v: 1, id, crm: { org, person }, to: [to], subject, text: text.endsWith('\n') ? text : text + '\n', attachments: [], ...(in_reply_to ? { in_reply_to } : {}), ...(send_after ? { send_after } : {}), created_at, created_by };
  return [{ path: `drafts/${id}.json`, record: d, text: JSON.stringify(d, null, 2) + '\n' }];
}
export const approvalFile = (a) => ({ path: `drafts/${a.draft_id}.approved.json`, record: a, text: JSON.stringify(a, null, 2) + '\n' });

// Reached before? (Dinis, 24 Nov 2026, via a.maestro: "people I sent a nudge ... because I don't want to send a nudge to
// people that [I nudged] before".) Every time we reached out to this person (or, with no person, to the company): logged
// actions with direction 'out' and our last emails, newest first. Notes and their replies do not count.
export function reachedBefore(v, { org, person = null }) {
  return timeline(v, org).filter((e) => e.direction === 'out' && e.kind !== 'note' && (person ? e.person === person : true));
}
// The warning to show before logging another outreach, or null: "Already reached out 2 times, last on 2026-11-20 (email: ...)".
export function nudgeWarning(v, { org, person = null, direction }) {
  if (direction !== 'out') return null;
  const before = reachedBefore(v, { org, person });
  if (!before.length) return null;
  const who = person ? v.people.find((p) => p.id === person)?.name || person : v.orgs.find((o) => o.id === org)?.name || org;
  const last = before[0], day = String(last.at).slice(0, 10);
  return `Already reached out to ${who} ${before.length === 1 ? 'once' : before.length + ' times'}, last on ${day} (${last.kind}: ${last.summary}).`;
}

// Import: a spreadsheet the team fills in (CSV, one row per person or per company), turned into the CRM's own
// files, shown first, written in one go. A person supplies and enters the data; nothing is guessed: a cell left
// empty stays empty. Columns (header row, any order, case-insensitive; only "company" is required):
export const IMPORT_COLUMNS = ['company', 'domain', 'kind', 'person', 'email', 'role', 'met', 'type', 'twin', 'stage', 'owner', 'next_step', 'next_step_due', 'last_contact_date', 'last_contact_kind', 'last_contact_direction', 'last_contact_summary'];

// RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. Returns rows of strings.
export function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

// The files an import writes, and a plain report: { files, report: { orgs, people, leads, actions, skipped: [..] } }.
// Companies match existing ones by domain, then by name; people by email. Existing records are never changed.
export function importFiles(v, text, { by, at, newId: mk = newId }) {
  if (!by) throw new Error('set your name first (top right)');
  if (!ISO.test(at || '')) throw new Error('needs the time, as an ISO time');
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('no rows: the first line is the header, then one line per contact');
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  if (!head.includes('company')) throw new Error('the header needs a "company" column');
  const unknown = head.filter((h) => h && !IMPORT_COLUMNS.includes(h));
  const files = [], report = { orgs: 0, people: 0, leads: 0, actions: 0, skipped: [], unknown_columns: unknown };
  const orgs = [...v.orgs], people = [...v.people];
  const byDomain = new Map(orgs.filter((o) => o.domain).map((o) => [o.domain.toLowerCase(), o]));
  const byName = new Map(orgs.map((o) => [o.name.toLowerCase(), o]));
  const emails = new Set(people.flatMap((p) => (p.emails || []).map((e) => e.toLowerCase())));
  const leadOrgs = new Set(v.leads.map((l) => l.org));
  rows.slice(1).forEach((cells, n) => {
    const line = n + 2, r = Object.fromEntries(head.map((h, i) => [h, String(cells[i] ?? '').trim()]));
    const skip = (why) => report.skipped.push(`line ${line}: ${why}`);
    if (!r.company) return skip('no company');
    const view = { ...v, orgs, people };
    let org = (r.domain && byDomain.get(r.domain.toLowerCase())) || byName.get(r.company.toLowerCase());
    if (!org) {
      const id = mk('o');
      let fs;
      try { fs = companyFiles(view, { id, name: r.company, domain: r.domain, kind: (r.kind || 'prospect').toLowerCase(), owner: r.owner || by, at, stage: v.stages.some((s) => s.id === (r.stage || '').toLowerCase()) ? r.stage.toLowerCase() : 'new', next_step: r.next_step }); }
      catch (e) { return skip(e.message); }
      if (r.next_step_due && /^\d{4}-\d{2}-\d{2}$/.test(r.next_step_due)) { fs[1].record.next_step_due = r.next_step_due; fs[1].text = JSON.stringify(fs[1].record, null, 2) + '\n'; }
      files.push(...fs); org = fs[0].record; orgs.push(org); leadOrgs.add(id); report.orgs++; report.leads++;
      if (org.domain) byDomain.set(org.domain, org); byName.set(org.name.toLowerCase(), org);
    }
    let personId = null;
    if (r.email || r.person) {
      if (!r.email && (r.type || '').toLowerCase() === 'team' && r.person) {
        if (people.some((p) => p.org === org.id && p.name.toLowerCase() === r.person.toLowerCase())) personId = people.find((p) => p.org === org.id && p.name.toLowerCase() === r.person.toLowerCase()).id;
        else { try { const [pf] = personFile({ ...v, orgs, people }, { id: mk('p'), name: r.person, email: '', role: r.role, met: r.met, type: 'team', twin: r.twin, org: org.id, by, at }); files.push(pf); people.push(pf.record); personId = pf.record.id; report.people++; } catch (e) { skip(e.message); } }
      } else if (!r.email) skip('a person with no email is not added (add their email, or leave the person out)');
      else if (emails.has(r.email.toLowerCase())) personId = people.find((p) => (p.emails || []).map((e) => e.toLowerCase()).includes(r.email.toLowerCase()))?.id || null;
      else {
        try {
          const [pf] = personFile({ ...v, orgs, people }, { id: mk('p'), name: r.person || r.email.split('@')[0], email: r.email, role: r.role, met: r.met, type: r.type, twin: r.twin, org: org.id, by, at });
          files.push(pf); people.push(pf.record); emails.add(r.email.toLowerCase()); personId = pf.record.id; report.people++;
        } catch (e) { skip(e.message); }
      }
    }
    if (r.last_contact_date) {
      const dir = { out: 'out', 'we reached out': 'out', in: 'in', 'they replied': 'in', none: 'none', note: 'none' }[(r.last_contact_direction || 'out').toLowerCase()] || 'out';
      try {
        const [af] = actionFile({ ...v, orgs, people }, { id: mk('a'), org: org.id, person: personId && people.find((p) => p.id === personId)?.org === org.id ? personId : null, kind: (r.last_contact_kind || 'email').toLowerCase(), direction: dir, at: r.last_contact_date, by, summary: r.last_contact_summary || `${r.last_contact_kind || 'contact'} (imported)`, logged_at: at });
        files.push(af); report.actions++;
      } catch (e) { skip(e.message); }
    }
  });
  return { files, report };
}

// The Day: what to do now, in order (design review round 1: "The first phone screen is the day's list"). Overdue next
// steps first, then follow-ups (we reached out, no reply in 5 days), then drafts waiting, then next steps due within a
// week; one card per company, under its most pressing reason. Counts by stage for the top of the page.
export function theDay(v, now, { soon = 7, owner = null } = {}) {
  // One card per company, with every reason it is here (a.crm.design, round 5 asks: "Today shows every reason a company has").
  // The card sorts by its most urgent reason: overdue, then waiting on a reply, then a draft, then due soon.
  const all = leadBoard(v, now), rows = owner ? all.filter((r) => r.owner === owner) : all;
  const dayOf = (iso) => Date.parse(iso + 'T23:59:59Z');
  const byOrg = new Map();
  const add = (r, why, detail, order, key) => { const c = byOrg.get(r.org) || { ...r, reasons: [], key: [9, 0] }; c.reasons.push({ why, detail }); if (order < c.key[0] || (order === c.key[0] && key < c.key[1])) c.key = [order, key]; byOrg.set(r.org, c); };
  for (const r of rows) {
    if (r.overdue) add(r, 'overdue', `since ${r.next_step_due}`, 0, dayOf(r.next_step_due));
    if (r.waiting) add(r, 'follow-up', `no reply for ${r.waiting.days} days`, 1, -r.waiting.days);
    if (r.draft.state === 'draft') add(r, 'draft', r.draft.count > 1 ? `${r.draft.count} drafts` : 'ready to review', 2, 0);
    if (r.next_step_due && !r.overdue && dayOf(r.next_step_due) - now < soon * DAY) add(r, 'soon', `due ${r.next_step_due}`, 3, dayOf(r.next_step_due));
  }
  const person = (c) => {
    // The person to talk to: the one with a waiting draft, else the one on the waiting thread, else the company's first.
    const d = v.drafts.find((x) => x.status === 'draft' && (x.org ?? v.people.find((p) => p.id === x.person)?.org) === c.org);
    const t = c.waiting && v.threads.find((x) => x.id === c.waiting.thread);
    const id = d?.person || t?.person || v.people.find((p) => p.org === c.org)?.id;
    const p = v.people.find((x) => x.id === id);
    return p ? { id: p.id, name: p.name, role: p.role || null, met: p.met || null } : null;
  };
  const cards = [...byOrg.values()].sort((x, y) => x.key[0] - y.key[0] || x.key[1] - y.key[1]).map((c) => ({ ...c, why: c.reasons.find((r) => r.why === ['overdue', 'follow-up', 'draft', 'soon'][c.key[0]]).why, detail: c.reasons.find((r) => r.why === ['overdue', 'follow-up', 'draft', 'soon'][c.key[0]]).detail, order: c.key[0], person: person(c) }));
  const count = (w) => cards.filter((c) => c.reasons.some((r) => r.why === w)).length;
  const stages = v.stages.map((s) => ({ ...s, count: all.filter((r) => r.stage === s.id).length }));
  return { cards, stages, total: all.length, counts: { overdue: count('overdue'), 'follow-up': count('follow-up'), draft: count('draft'), soon: count('soon') } };
}

// The People page: the team, the agents and the synthetic users, each with their twin inbox and their latest action
// (Dinis Cruz, 25 Nov 2026: "some synthetic users which we need to also have a full UI to see (and act on them)").
export function peopleByType(v) {
  const orgName = new Map(v.orgs.map((o) => [o.id, o.name])), out = { team: [], agent: [], synthetic: [], contacts: 0 };
  for (const p of v.people) {
    if (!PERSON_TYPES.includes(p.type)) { out.contacts++; continue; }
    const acts = v.actions.filter((a) => a.person === p.id).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    out[p.type].push({ id: p.id, name: p.name, org: p.org, org_name: orgName.get(p.org) || null, role: p.role || null, email: (p.emails || [])[0] || null, twin: p.twin || null, actions: acts.length, last: acts[0] || null });
  }
  for (const k of PERSON_TYPES) out[k].sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// Signed batches (a proposal; demo only until Dinis approves ABP line C9). Pure functions, no page access.
// Dinis, 24 Nov 2026 (relayed by a.maestro): "I should be able to sign them off ... once I'm happy with
// it, we can just send the emails from there ... maybe even in batches ... PDFs, screenshots, images".
// Formats agreed by a.mail.conductor, crm.dev.a and mail.dev.a, 24 Nov 2026 (16:06 UTC), all in the CRM vault:
//   drafts/<id>.json           { v:1, id, crm:{org, person, thread?}, to:[one address], subject, text,
//                                attachments:[{ path, type, bytes, sha256 }], send_after?, created_at, created_by }
//   drafts/<id>.approved.json  { draft_id, draft_sha256, key_fingerprint, signed_at, batch_id, sig }
//   sent/<id>.json             { draft_id, draft_sha256, batch_id, gmail_id, gmail_thread_id, sent_at, approved_by_key }
// draft_sha256 = SHA-256 hex of canon(draft) (pki.sgit.ai keys.js v0.2.28, vendored unedited), UTF-8, no
// trailing newline. sig = ECDSA P-256 / SHA-256, IEEE P1363, base64, over the UTF-8 string
// draft_sha256 + batch_id (no separator; the hash is always 64 hex characters).
// By mail.dev.a@AgentiCCells.dinis, 2026-11-24. Apache-2.0.
import { canon } from './vendor/pki/v0.2.28/keys.js';
import { messageOf, problems, MAX_PER_DAY } from './send.js?v=2b2f4c9';

export const MAX_ATTACH_BYTES = 10 * 1024 * 1024; // per email, all attachments together
export const ATTACH_TYPES = { 'application/pdf': [0x25, 0x50, 0x44, 0x46], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8, 0xff] };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };
const KEY = { name: 'ECDSA', namedCurve: 'P-256' };
const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const sha256hex = async (bytes) => hex(await subtle.digest('SHA-256', bytes));
export const b64 = (bytes) => { let s = ''; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s); };
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const iso = (d) => d.toISOString().replace(/\.\d+Z$/, 'Z');

// sgit's fingerprint: the first 16 hex characters of SHA-256 over the key's SPKI DER.
export async function fingerprint(spki) { return 'sha256:' + (await sha256hex(spki)).slice(0, 16); }
export const draftHash = (draft) => sha256hex(enc.encode(canon(draft)));
const signedString = (draftSha, batchId) => enc.encode(String(draftSha) + String(batchId));
export const newBatchId = (now = new Date(), rand = crypto.getRandomValues(new Uint8Array(2))) => `b-${iso(now).replace(/[-:]/g, '')}-${hex(rand)}`;

// The person's sign-off for one draft in one batch.
export async function approve(privateKey, publicSpki, draft, batchId, now = new Date()) {
  const draft_sha256 = await draftHash(draft);
  const sig = await subtle.sign(SIGN, privateKey, signedString(draft_sha256, batchId));
  return { draft_id: draft.id, draft_sha256, key_fingerprint: await fingerprint(publicSpki), signed_at: iso(now), batch_id: batchId, sig: b64(sig) };
}

// The email a draft becomes: one To address, no Cc, no Bcc.
export function messageOfDraft(d) {
  return messageOf({ to: d.to, subject: d.subject, status: 'draft', in_reply_to: d.in_reply_to || '', thread_id: d.crm?.thread || '' }, d.text);
}

// The attachment checks, on the bytes read from the vault: listed size and SHA-256 match, a known type
// whose first bytes match it, a plain file name, and at most 10 MB together.
export async function attachmentProblems(list = [], files = {}) {
  const out = [];
  let total = 0;
  for (const a of list) {
    const name = String(a.path || '').split('/').pop();
    const bytes = files[a.path];
    if (!bytes) { out.push(`${name}: the file is missing`); continue; }
    total += bytes.length;
    if (bytes.length !== a.bytes) out.push(`${name}: its size is not the one signed`);
    if ((await sha256hex(bytes)) !== a.sha256) out.push(`${name}: its content is not the one signed`);
    const magic = ATTACH_TYPES[a.type];
    if (!magic) out.push(`${name}: only PDF, PNG and JPEG may be attached`);
    else if (!magic.every((b, i) => bytes[i] === b)) out.push(`${name}: its content is not a ${a.type} file`);
    if (!/^[^\\/\r\n"]{1,120}$/.test(name)) out.push('an attachment has a bad file name');
  }
  if (total > MAX_ATTACH_BYTES) out.push(`attachments come to ${(total / 1048576).toFixed(1)} MB; at most 10 MB`);
  return out;
}

// pinned: [{ fingerprint, spki (Uint8Array), name }]. Returns { ok, signer, reason }.
export async function verifyApproval(draft, approved, pinned, batchId) {
  if (!approved) return { ok: false, reason: 'not signed off' };
  if (approved.draft_id !== draft.id) return { ok: false, reason: 'the sign-off is for another draft' };
  if (batchId && approved.batch_id !== batchId) return { ok: false, reason: `signed off for batch ${approved.batch_id}, not this one` };
  if (approved.draft_sha256 !== (await draftHash(draft))) return { ok: false, reason: 'the draft changed after it was signed off' };
  const pin = pinned.find((p) => p.fingerprint === approved.key_fingerprint);
  if (!pin) return { ok: false, reason: `signed off by ${approved.key_fingerprint}, a key not pinned in this page` };
  if ((await fingerprint(pin.spki)) !== pin.fingerprint) return { ok: false, reason: 'the pinned key does not match its fingerprint' };
  const key = await subtle.importKey('spki', pin.spki, KEY, false, ['verify']);
  let good = false;
  try { good = await subtle.verify(SIGN, key, unb64(approved.sig), signedString(approved.draft_sha256, approved.batch_id)); } catch { good = false; }
  return good ? { ok: true, signer: pin.name || pin.fingerprint } : { ok: false, reason: 'the signature does not match' };
}

// One batch: every draft with its verdict, and which ones one press would send, in order, at most the
// day's remaining allowance. items: [{ draft, approved, files, sent }].
export async function planBatch(items, { pinned = [], sentToday = 0, batchId = '', now = new Date() } = {}) {
  const rows = [];
  let room = Math.max(0, MAX_PER_DAY - sentToday);
  for (const it of items) {
    const d = it.draft, m = messageOfDraft(d);
    const why = [];
    if (it.sent) why.push('already sent');
    if (d.v !== 1) why.push('unknown draft format');
    if (!Array.isArray(d.to) || d.to.length !== 1) why.push('a draft goes to exactly one address');
    why.push(...problems(m, { sentToday: 0 }));
    why.push(...(await attachmentProblems(d.attachments, it.files)));
    if (d.send_after && Date.parse(d.send_after) > now.getTime()) why.push(`not before ${d.send_after}`);
    const v = await verifyApproval(d, it.approved, pinned, batchId);
    if (!v.ok) why.push(v.reason);
    if (!why.length && room === 0) why.push(`the daily limit of ${MAX_PER_DAY} is reached; it waits for tomorrow`);
    const send = !why.length;
    if (send) room--;
    rows.push({ id: d.id, m, signer: v.signer || '', send, why });
  }
  return { rows, toSend: rows.filter((r) => r.send).length };
}

// What the page writes back to the CRM vault after each send.
export const sentRecord = (draft, approved, res, now = new Date()) => ({ draft_id: draft.id, draft_sha256: approved.draft_sha256, batch_id: approved.batch_id, gmail_id: res.id, gmail_thread_id: res.threadId, sent_at: iso(now), approved_by_key: approved.key_fingerprint, ...(res.simulation ? { simulation: true } : {}) });

// The RFC 5322 message with attachments (multipart/mixed), as Gmail's messages.send takes it.
export function rawWithAttachments(m, atts = [], boundary = 'cell-' + Math.random().toString(36).slice(2)) {
  const word = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(enc.encode(s))}?=`);
  const wrap = (s) => s.replace(/.{76}/g, '$&\r\n');
  const head = [`To: ${m.to.join(', ')}`, `Subject: ${word(m.subject)}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`, `References: ${m.inReplyTo}`] : []), 'MIME-Version: 1.0'];
  const textPart = ['Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrap(b64(enc.encode(m.text.replace(/\r?\n/g, '\r\n'))))].join('\r\n');
  let raw;
  if (!atts.length) raw = [...head, textPart].join('\r\n');
  else {
    const parts = [textPart, ...atts.map((a) => [`Content-Type: ${a.type}; name="${a.name}"`, `Content-Disposition: attachment; filename="${a.name}"`, 'Content-Transfer-Encoding: base64', '', wrap(b64(a.data))].join('\r\n'))];
    raw = [...head, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', ...parts.map((p) => `--${boundary}\r\n${p}`), `--${boundary}--`, ''].join('\r\n');
  }
  return b64(enc.encode(raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const attachmentsFor = (d, files) => (d.attachments || []).map((a) => ({ name: a.path.split('/').pop(), type: a.type, data: files[a.path] }));

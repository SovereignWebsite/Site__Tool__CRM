// "You": this browser's identity and the vaults it holds (Dinis Cruz, 24 Nov 2026: "a login button ... use a passkey
// if it's available ... If not ... one that is tied to that browser session"; keys handed over by QR code).
// - Log in makes this browser's key pair with the Email Cell's pki.js (RSA-OAEP 4096 and ECDSA P-256, private halves
//   NOT extractable, kept in this browser's IndexedDB) and shows its public half as a pki.sgit.ai QR code and k1 text,
//   to send to Dinis. If the device has a passkey (a platform authenticator), the page makes one for this site and
//   asks for it once per tab before any vault key is used. The passkey is a lock in front of the browser key, not the
//   key itself: it proves the person is here, it does not encrypt anything.
// - A sealed code (pki.sgit.ai m1, sealed to this browser's key) from a trusted sender (trusted.js, built from the
//   agent's published key) is opened here; the vault keys in it are kept sealed to this browser's key and listed.
// By crm.dev.a@AgentiCCells.dinis, 2026-11-24. Apache-2.0.
import { identity, existingIdentity, publicQrText, publicCode, openSealed, keep, recall, forget } from './pki.js';
import { TRUSTED } from './trusted.js';
import qrcode from './vendor/qrcode-generator/2.0.4/qrcode.mjs';

const LABEL = () => 'CRM tool, ' + location.host;
const PASSKEY = 'crm.passkey';          // the credential id (not a secret), in this browser only
let unlocked = false;

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };

export async function passkeyAvailable() {
  try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
}
export const hasPasskey = () => !!ls.get(PASSKEY);

async function makePasskey(name) {
  const cred = await navigator.credentials.create({ publicKey: {
    rp: { name: 'CRM', id: location.hostname },
    user: { id: crypto.getRandomValues(new Uint8Array(16)), name: name || 'crm user', displayName: name || 'CRM user' },
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
    timeout: 60000,
  } });
  ls.set(PASSKEY, b64u(cred.rawId));
}
// Ask for the passkey once per tab, when there is one. Without a passkey on this device the browser key stands alone.
export async function unlock() {
  if (unlocked || !hasPasskey()) { unlocked = true; return true; }
  await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: 'public-key', id: unb64u(ls.get(PASSKEY)) }], userVerification: 'required', timeout: 60000 } });
  unlocked = true; return true;
}

export async function loggedIn() { return !!(await existingIdentity().catch(() => null)); }
export async function logIn(name) {
  const id = await identity(LABEL());
  if (!hasPasskey() && await passkeyAvailable()) { try { await makePasskey(name); } catch (e) { /* refused or not possible: the browser key stands alone */ } }
  unlocked = true;
  return id;
}
export async function myKey() {
  const id = await existingIdentity(); if (!id) return null;
  const text = publicQrText(id), qr = qrcode(0, 'L'); qr.addData(text); qr.make();
  return { fp: id.bundle.signing_fingerprint, text, code: publicCode(id), qr: qr.createDataURL(4, 8) };
}

// The vaults this browser holds: [{ id, name, role, added }], kept sealed like the keys themselves.
export async function vaults() { const id = await existingIdentity(); if (!id) return []; try { return JSON.parse((await recall(id, 'vaults')) || '[]'); } catch { return []; } }
async function saveVaults(list) { await keep(await existingIdentity(), 'vaults', JSON.stringify(list)); }
export async function vaultKey(vid) { await unlock(); return recall(await existingIdentity(), 'vault:' + vid); }
export async function forgetVault(vid) { await forget('vault:' + vid); await saveVaults((await vaults()).filter((v) => v.id !== vid)); }

// Open a sealed code: only from a trusted sender. nameOf(key) reads the vault's manifest to name it.
export async function receive(text, nameOf) {
  await unlock();
  const id = await existingIdentity(); if (!id) throw new Error('log in first');
  const r = await openSealed(id, String(text).trim(), TRUSTED);
  if (r.needsConfirm) throw new Error(`sealed and signed by a key this page does not know (${r.signer || 'unsigned'}): refused`);
  const list = await vaults(), added = [];
  for (const k of r.vaultKeys) {
    let name = k.id; try { name = (await nameOf(k.key)) || k.id; } catch {}
    await keep(id, 'vault:' + k.id, k.key);
    const i = list.findIndex((v) => v.id === k.id), entry = { id: k.id, name, added: new Date().toISOString().slice(0, 10) };
    if (i >= 0) list[i] = entry; else list.push(entry);
    added.push(entry);
  }
  if (r.grant?.token) await keep(id, 'token:sg-send', r.grant.token);
  await saveVaults(list);
  return { from: r.from, note: r.msg?.text ? r.msg.text.replace(/(?:sgit_private_vault_)?[a-z0-9]{16,64}:[a-z0-9]{6,32}/g, '[vault key]') : '', added, token: !!r.grant?.token };
}
export async function savedToken() { const id = await existingIdentity(); if (!id) return ''; await unlock(); return (await recall(id, 'token:sg-send').catch(() => null)) || ''; }
export async function logOut() { for (const v of await vaults()) await forget('vault:' + v.id); await forget('vaults'); await forget('token:sg-send'); ls.del(PASSKEY); unlocked = false; }

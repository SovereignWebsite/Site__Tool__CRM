// Send a request to the CRM's keeper: the feedback loop (Dinis, 23 Nov 2026: "the feedback loop ... So I can start to use
// the feedback loop from the website already, the CRM"). Copied from SovereignWebsite/Site__Organisation__Chiswick-Cheese-Market
// site/send/send.js at 65002f9 (Apache-2.0; chiswick-cheese-market.c, after kate-curtis-evans.b's admin/message/message.js,
// built on SGit-AI__Website__Web-Summit's assets/feedback.js), sent verbatim by a.maestro on 23 Nov 2026 (23:42 UTC); for
// the CRM tool site by crm.dev.a@AgentiCCells.dinis. Changed only: the request type (crm.request/v1), the jsQR path, and a
// plain message when this site's inbox is not set up yet.
// The message is sealed to the agent's public key with sgit's hybrid envelope v2 (byte-compatible with
// PKI__Crypto.hybrid_decrypt), signed with the person's key held in this browser (keyring.js), and appended to the keeper's
// lane on its sgit vault. The lane token can only append. Replies from the agent are sealed to the person (ws-ecies-1) in
// replies/<person>.json; only this browser opens them.
(() => {
    'use strict'
    const $ = s => document.querySelector(s)
    const b64 = bytes => { let s = ''; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s) }
    const unpem = pem => Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')), c => c.charCodeAt(0))
    let CFG = null, images = []

    async function seal(pem, text) {
        const subtle = crypto.subtle
        const pub = await subtle.importKey('spki', unpem(pem), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
        const aes = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const c = await subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aes, new TextEncoder().encode(text))
        const w = await subtle.encrypt({ name: 'RSA-OAEP' }, pub, await subtle.exportKey('raw', aes))
        return btoa(JSON.stringify({ v: 2, w: b64(w), i: b64(iv), c: b64(c) }))
    }
    async function append(text) {
        const enc = await seal(CFG.recipient.encrypt, text)
        const r = await fetch(`${CFG.endpoint}/api/vault/append/write/${CFG.vault_id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ append_token: CFG.append_token, payload: btoa(enc) }) })
        if (!r.ok) throw new Error(r.status === 413 ? 'that is too big for one message: try a smaller photo' : r.status === 507 ? 'the inbox is full until the keeper reads it' : `the inbox answered ${r.status}`)
    }
    // photos: scaled to at most 1600 px on the long side, as JPEG, so a message stays well under the service's limit (a request must be under 6 MiB, measured by feedback.b, 21 Nov 2026)
    function shrink(file) {
        return new Promise((ok, no) => {
            const img = new Image(), url = URL.createObjectURL(file)
            img.onload = () => {
                const k = Math.min(1, 1600 / Math.max(img.width, img.height)), cv = document.createElement('canvas')
                cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k)
                cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url)
                ok({ name: file.name, type: 'image/jpeg', data: cv.toDataURL('image/jpeg', 0.85) })
            }
            img.onerror = () => no(new Error(`${file.name} is not an image this browser can read`)); img.src = url
        })
    }
    function say(t, bad) { const el = $('#status'); el.textContent = t; el.className = bad ? 'status bad' : 'status ok' }

    async function showWho() {
        const KR = window.WSKeyring; await KR.ready
        const who = KR.person, name = who
        $('#req').classList.toggle('has-key', !!who)
        $('#who').textContent = who ? `Signed in as ${name} (key ...${(KR.fingerprint || '').slice(-4)})` : 'No key in this browser yet.'
        $('#lock').hidden = !who; $('#form').hidden = !who
        $('#addkey').open = !who; $('#addkey').querySelector('summary').textContent = who ? 'Use a different key' : 'Add your key'
        if (who) showReplies(who)
    }
    async function showReplies(who) {
        const box = $('#replies'); box.innerHTML = ''
        let list = []
        try { const r = await fetch(`replies/${who}.json`, { cache: 'no-store' }); if (r.ok) list = await r.json() } catch { }
        if (!list.length) { box.innerHTML = '<p class="muted">No answers yet. When the keeper answers, it appears here, readable only in this browser.</p>'; return }
        for (const env of list.slice().reverse()) {
            const d = document.createElement('article'); d.className = 'reply'
            try { const m = await window.WSKeyring.open(env); d.innerHTML = `<p class="when"></p><p class="text"></p>`; d.querySelector('.when').textContent = `${m.at || env.at} · ${m.re ? 'about: ' + m.re : ''}`; d.querySelector('.text').textContent = m.text }
            catch (e) { d.textContent = 'A reply this browser cannot open (' + e.message + ').' }
            box.appendChild(d)
        }
    }
    async function send(ev) {
        ev.preventDefault()
        const KR = window.WSKeyring, kind = $('#kind').value, text = $('#text').value.trim()
        if (!text && !images.length) return say('Write something first.', true)
        $('#send').disabled = true; say('Sealing and sending...')
        try {
            const body = { kind, text, images }, items_json = JSON.stringify(body)
            const signed = { person: KR.person, key: KR.fingerprint, alg: 'ECDSA-P256-SHA256-P1363', sig: await KR.sign(items_json) }
            await append(JSON.stringify({ type: 'crm.request/v1', to: CFG.agent, site: location.origin, sent_at: new Date().toISOString(), from: KR.person, signed, items_json }))
            $('#text').value = ''; images = []; $('#thumbs').innerHTML = ''
            say('Sent. The keeper reads its inbox, acts on it within the policy, and answers here.')
        } catch (e) { say('Not sent: ' + e.message, true) } finally { $('#send').disabled = false }
    }
    // The key, however the person has it (Dinis, 22 Nov 2026: "make these as easy as possible"): the QR picture
    // pasted (Ctrl+V or Cmd+V anywhere on the page), dropped, chosen as a file or held up to the camera, or the link
    // pasted, which is added at once. Once a key is in, a pasted or dropped picture becomes a screenshot instead.
    const signedIn = () => !!window.WSKeyring.person
    async function useKeyText(t) {
        try { const p = await window.WSKeyring.add(t); $('#keylink').value = ''; stopCamera(); say(`Key added for ${p}. You can write your request now.`); await showWho(); $('#text').focus() }
        catch (e) { say(e.message, true) }
    }
    let jsqrLoad = null
    const loadJsQR = () => (jsqrLoad = jsqrLoad || new Promise((ok, no) => {
        const sc = document.createElement('script'); sc.src = '../vendor/jsqr/1.4.0/jsQR.js'
        sc.onload = () => ok(window.jsQR); sc.onerror = () => no(new Error('the QR reader could not be loaded')); document.head.append(sc)
    }))
    async function qrFrom(source, w, h) {
        if ('BarcodeDetector' in window) {
            try { const c = await new BarcodeDetector({ formats: ['qr_code'] }).detect(source); if (c.length) return c[0].rawValue } catch { }
        }
        const jsQR = await loadJsQR(), k = Math.min(1, 1600 / Math.max(w, h)), cv = document.createElement('canvas')
        cv.width = Math.round(w * k); cv.height = Math.round(h * k)
        const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(source, 0, 0, cv.width, cv.height)
        const r = jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height)
        return r ? r.data : null
    }
    async function keyFromPicture(file) {
        say('Reading the QR code...')
        try {
            const bmp = await createImageBitmap(file), t = await qrFrom(bmp, bmp.width, bmp.height)
            if (!t) return say('No QR code found in that picture. Try a sharper or larger picture, or paste the link.', true)
            if (!/key=/.test(t)) return say('That QR code is not a key for this page.', true)
            await useKeyText(t)
        } catch (e) { say('That picture could not be read: ' + e.message, true) }
    }
    async function addScreenshots(files) {
        for (const f of files) {
            if (images.length >= 4) { say('Four pictures at most in one request.', true); break }
            try { const im = await shrink(f); images.push(im); const t = document.createElement('img'); t.src = im.data; t.alt = ''; $('#thumbs').appendChild(t) } catch (x) { say(x.message, true) }
        }
        if (images.length) say(`${images.length} picture${images.length > 1 ? 's' : ''} added to your request.`)
    }
    const pictures = list => [...list].filter(f => f && f.type && f.type.startsWith('image/'))
    async function takePictures(files) {
        const imgs = pictures(files); if (!imgs.length) return false
        if (signedIn()) await addScreenshots(imgs); else await keyFromPicture(imgs[0])
        return true
    }
    // the camera: frames read until a key is found, or the person stops it
    let stream = null, timer = null
    function stopCamera() {
        if (timer) clearInterval(timer); timer = null
        if (stream) stream.getTracks().forEach(t => t.stop()); stream = null
        $('#cam').hidden = true; $('#cambtn').textContent = 'Scan with the camera'
    }
    async function startCamera() {
        if (stream) return stopCamera()
        try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }) }
        catch (e) { return say('The camera could not be opened (' + (e.message || e.name) + '). Paste or choose the QR picture instead.', true) }
        const v = $('#cam'); v.srcObject = stream; v.hidden = false; await v.play(); $('#cambtn').textContent = 'Stop the camera'
        say('Hold the QR code up to the camera.')
        let busy = false
        timer = setInterval(async () => {
            if (busy || !v.videoWidth) return; busy = true
            try { const t = await qrFrom(v, v.videoWidth, v.videoHeight); if (t && /key=/.test(t)) await useKeyText(t) } catch { } finally { busy = false }
        }, 350)
    }
    async function main() {
        try { CFG = await (await fetch('inbox.json', { cache: 'no-store' })).json() } catch { CFG = null }
        // Not in the original: until the keeper has an inbox, say so instead of failing on send.
        if (!CFG || !CFG.vault_id || !CFG.append_token || !CFG.recipient?.encrypt) {
            $('#notready').hidden = false; $('#req').hidden = true
            return
        }
        $('#form').addEventListener('submit', send)
        $('#addbtn').addEventListener('click', () => useKeyText($('#keylink').value))
        $('#keylink').addEventListener('input', e => { if (/key=[A-Za-z0-9_-]{100,}/.test(e.target.value)) useKeyText(e.target.value) })
        $('#qrfile').addEventListener('change', e => { takePictures(e.target.files); e.target.value = '' })
        $('#cambtn').addEventListener('click', startCamera)
        if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) $('#cambtn').hidden = true
        $('#lock').addEventListener('click', async () => { await window.WSKeyring.lock(); say('Your key is removed from this browser.'); showWho() })
        $('#files').addEventListener('change', e => { addScreenshots(pictures(e.target.files)); e.target.value = '' })
        // paste anywhere: a picture (the QR code, or a screenshot once signed in) or the key link
        document.addEventListener('paste', async e => {
            const cd = e.clipboardData; if (!cd) return
            const files = [...cd.items].filter(i => i.kind === 'file').map(i => i.getAsFile())
            if (pictures(files).length) { e.preventDefault(); return takePictures(files) }
            const t = cd.getData('text') || ''
            if (/key=[A-Za-z0-9_-]{100,}/.test(t) && e.target !== $('#text')) { e.preventDefault(); useKeyText(t) }
        })
        // drop anywhere on the page
        const over = on => document.documentElement.classList.toggle('dropping', on)
        window.addEventListener('dragover', e => { if ([...(e.dataTransfer?.items || [])].some(i => i.kind === 'file')) { e.preventDefault(); over(true) } })
        window.addEventListener('dragleave', e => { if (!e.relatedTarget) over(false) })
        window.addEventListener('drop', e => { over(false); if (e.dataTransfer?.files?.length) { e.preventDefault(); takePictures(e.dataTransfer.files) } })
        showWho()
    }
    main()
})()

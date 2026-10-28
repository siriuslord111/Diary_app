# Calculator (Private Diary Disguise)

A private, client-side diary app disguised as a stock Android calculator. Built as a Progressive Web App (PWA) with plain HTML5, CSS3, and modern JavaScript (ES modules). Zero dependencies, zero external network requests, zero CDNs, and fully functional offline after the first visit.

---

## Architecture & Security Highlights

1. **Disguise & Expression Parser**:
   - Complete Google/Android calculator keypad and two-line display (formula above, result below).
   - Safe custom recursive-descent math parser (`parser.js`) with zero `eval()` or `Function()`.
   - Repeated `=` repeats the last operation (e.g. `5 + 3 = 8`, `=` gives `11`, then `14`).
   - Format error and division by zero protection ("Can't divide by zero").

2. **Asynchronous Zero-Lag Unlock**:
   - Unlock derivation runs in a background Web Worker (`crypto-worker.js`) using Web Crypto API.
   - Immediate display of calculator results on `=` with zero UI stutter or timing leaks.
   - Wrong calculation expressions behave identically to standard calculator usage.

3. **Military-Grade Key Hierarchy & Dual Wrapping**:
   - Random 256-bit AES-GCM Master Key.
   - **Copy A**: Wrapped with PBKDF2-SHA256 (600,000 iterations, 16-byte random salt) derived from secret calculation.
   - **Copy B**: Wrapped with a hardware/browser-bound non-extractable device key stored in IndexedDB.
   - Changing or resetting secrets re-wraps the master key; entries are never re-encrypted.
   - Plaintext entries are stored only in volatile memory while unlocked; IndexedDB records contain only AES-GCM 256-bit ciphertext and fresh 12-byte IVs.
   - `navigator.storage.persist()` is invoked to prevent browser eviction.

4. **Privacy & Auto-Lock**:
   - Instant auto-lock and memory purge on:
     - Backgrounding or tab switch (`visibilitychange`)
     - Window blur / focus loss (`blur`)
     - Page navigation or Android Back button (`popstate`)
     - 60 seconds of inactivity
   - Screen blanking mask (`#privacy-shield`) to prevent Android task switcher previews from revealing diary contents.
   - Single URL with no route changes in browser history.
   - Neutral file name (`data-view.js`) loaded dynamically only after unlock.

5. **Recovery & Backup**:
   - **Forgot Secret (= x100)**: Tapping `=` 100 consecutive times unlocks via the device key (Copy B), allowing the user to set a new calculation without losing entries.
   - **Encrypted Backup Export/Import**: Export and import encrypted JSON backups protected by the secret calculation.

---

## Hosting Instructions (HTTPS Required)

Web Cryptography API (`crypto.subtle`) and Service Workers require a secure context (**HTTPS** or `localhost`).

### Option A: GitHub Pages (Free & Fast)
1. Push this folder to a GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<username>/<repo-name>.git
   git push -u origin main
   ```
2. In GitHub, go to your repository **Settings** -> **Pages**.
3. Under **Branch**, select `main` and root `/`, then click **Save**.
4. In a few minutes, your site will be live at `https://<username>.github.io/<repo-name>/`.

### Option B: Netlify (Drag & Drop)
1. Go to [Netlify](https://www.netlify.com/) and log in.
2. Drag and drop this folder directly into the Netlify Sites dashboard.
3. Your app is instantly deployed on HTTPS at a `.netlify.app` subdomain.

### Option C: Local Testing
Run a local static server:
```bash
python -m http.server 8000
```
Open `http://localhost:8000` in Google Chrome.

---

## Installing on Android (Google Chrome)

1. Open the hosted HTTPS URL in **Chrome on Android**.
2. Tap the Chrome three-dot menu icon `⋮` in the top right corner.
3. Select **Add to Home screen** (or **Install app**).
4. Confirm installation. The app will appear on your Android home screen and app drawer with the icon and title **Calculator**.
5. Once launched from the home screen, it opens full-screen in standalone portrait mode and works 100% offline.

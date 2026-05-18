# "Add to OurFlix" — iOS Shortcut

A tiny Apple Shortcut that lets you upload photos / videos straight from
the Photos Share Sheet. Builds in ~5 minutes on the phone itself (Apple
Shortcuts can only be built on an iPhone/iPad/Mac; not from desktop).

## What you'll get

Photos app → pick photos → **Share** → **Add to OurFlix** → tap an album →
done. Photos appear on the live site in ~1 minute (GitHub Actions resizes
and commits them).

---

## Part 1 — Get a GitHub Personal Access Token (PAT)

You can re-use the same PAT the in-OURFLIX +button asked for. If you don't
have one yet:

1. On the phone, open Safari → https://github.com/settings/personal-access-tokens/new
2. **Token name**: `OurFlix Shortcut`
3. **Expiration**: 90 days (calendar reminder to renew)
4. **Repository access** → **Only select repositories** → tick `moonvault`
5. **Repository permissions** → scroll → **Contents** → **Read and write**
6. Generate token → copy the `github_pat_...` string somewhere you can paste
   it (Notes app is fine; you'll delete it right after).

---

## Part 2 — Build the Shortcut

Open the **Shortcuts** app on the phone. Tap **+** (top-right) → blank
shortcut. Add the actions below, in order. Action names exactly match the
Shortcuts app search — type the name in the search bar to find each one.

Tip: tap the action title bar to expand its options.

### Step 1: Make it a Share Sheet target

1. Tap **(i)** at the bottom of the shortcut editor.
2. Toggle **Show in Share Sheet** ON.
3. Under **Share Sheet Types** uncheck everything except **Images** and
   **Media** (videos count as media).
4. Tap **Done**.

### Step 2: Save the album list from the live manifest

Action: **Get Contents of URL**
- URL: `https://raw.githubusercontent.com/theepicuremale/moonvault/main/assets/manifest.json`
- Method: GET (default)

Action: **Get Dictionary Value**
- Get: **Value**
- Key: `albums`
- From: the previous step's output

Action: **Get Names From Input**
- (Some iOS versions call this "Get Names of dictionary items". If you
  can't find it, use this fallback: add **Repeat with Each** over the
  dictionary list → inside add **Get Dictionary Value** → Get: Value, Key:
  `title`, From: Repeat Item → add **Add to Variable**, Variable name
  `AlbumTitles`. End Repeat.)

If you used "Get Names From Input", store its result with **Set Variable**
named `AlbumTitles`.

### Step 3: Prepend "+ New album…" so you can also create new albums

Action: **Text**
- Content: `+ New album…`

Action: **Add to Variable**
- Variable name: `AlbumChoices`
- Input: the previous Text

Action: **Add to Variable**
- Variable name: `AlbumChoices`
- Input: `AlbumTitles` variable

### Step 4: Pick the album

Action: **Choose from List**
- List: `AlbumChoices`
- Prompt: `Album`
- Select Multiple: OFF

Action: **If**
- Condition: **Chosen Item** **is** `+ New album…`
- Inside the IF:
  - Action: **Ask for Input**
    - Input Type: Text
    - Prompt: `New album name`
  - Action: **Set Variable**, name `Album`, value: **Provided Input**
- Otherwise:
  - Action: **Set Variable**, name `Album`, value: **Chosen Item**
- End If.

### Step 5: Upload each shared item

Action: **Repeat with Each** (input: the shortcut's Share Sheet Input — the
photos you picked)

Inside the Repeat:

1. Action: **Get File Names**
   - Files: Repeat Item
   - Include File Extensions: ON
   - (Fallback if your iOS doesn't have it: use **Format Date** to build
     a name like `IMG_<currentDateTime>.jpeg` and use that.)
   - Save as variable `FileName`.

2. Action: **Base64 Encode**
   - Encode: **Encode**
   - Line Break: **No Line Breaks**
   - Input: Repeat Item
   - Save as variable `B64`.

3. Action: **Text**
   - Content (one line, no smart quotes):
     `{"message":"upload from iOS","content":"[B64]","branch":"incoming"}`
   - Where `[B64]` is the magic-variable pill for `B64`.

4. Action: **Get Contents of URL**
   - URL: `https://api.github.com/repos/theepicuremale/moonvault/contents/photos/[Album]/[FileName]`
     - Insert `Album` and `FileName` as magic-variable pills.
   - Method: **PUT**
   - Headers (tap **Show More** → **Headers**):
     - `Authorization` = `Bearer <YOUR_PAT_HERE>`
     - `Accept` = `application/vnd.github+json`
     - `X-GitHub-Api-Version` = `2022-11-28`
   - Request Body: **File**
     - File: the **Text** from step 3.
     - (Some iOS versions show this as "Request Body: Form" + a JSON
       option; in any case the body must be the JSON text from step 3.)

End Repeat.

### Step 6: Notify on success

Action: **Show Notification**
- Title: `OurFlix`
- Body: `✓ Sent to "[Album]". Live in ~1 min.`

Save the shortcut with the name **Add to OurFlix**.

---

## Part 3 — Use it

1. Photos app → pick 1+ photos or videos → **Share**.
2. Scroll the Share Sheet → tap **Add to OurFlix**.
3. Pick an album from the list (or `+ New album…`).
4. Wait for the notification.
5. Open OURFLIX in ~1 minute — your photos are there.

The first run will ask "Allow Add to OurFlix to access api.github.com?" —
tap **Always Allow**.

---

## Troubleshooting

- **"401 Unauthorized"**: the PAT expired or was revoked. Generate a new one
  (Part 1) and edit the Shortcut → step 5 → Headers → replace the
  `Authorization` value.

- **The Shortcut isn't visible in Share Sheet**:
  - Open Settings → Shortcuts → Share Sheet → toggle "Add to OurFlix" ON.
  - In the Shortcut editor → (i) info → make sure "Show in Share Sheet" is ON.

- **Album list is empty**:
  - Open Safari and visit
    https://raw.githubusercontent.com/theepicuremale/moonvault/main/assets/manifest.json
    If JSON loads, the Shortcut's URL is fine; otherwise check spelling.

- **A file fails with 404**:
  - The `incoming` branch may have been deleted. Run
    `tools/bootstrap-incoming.ps1` from a laptop to recreate it.

- **HEIC photos**: supported. The Actions workflow on the server converts
  them to JPEG via ffmpeg before publishing.

---

## What happens server-side after upload

1. Your `PUT` creates a commit on the `incoming` branch.
2. The `.github/workflows/process-incoming.yml` workflow fires.
3. It runs the build:
   - Resizes originals to ≤1600 px on the longer edge.
   - Generates a 480 px thumbnail.
   - Strips EXIF (incl. GPS) from the resized full.
   - Decodes HEIC to JPEG via ffmpeg.
   - Updates `assets/manifest.json` (album entry, date label, cover).
4. Commits to `main` as `github-actions[bot]`.
5. Force-resets `incoming` back to a placeholder (with the workflow file
   preserved) so originals never linger.
6. GitHub Pages rebuilds and serves the new photos.

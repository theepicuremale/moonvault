# Add to OurFlix — iOS Shortcut setup

Build a tiny Apple Shortcut on your iPhone so you can upload photos / videos
to a OurFlix album straight from the Photos app's Share Sheet. No
re-installing the Shortcuts app — it ships preinstalled on every iPhone.

## What you'll get

1. Open Photos → pick photo(s) → **Share** → **Add to OurFlix**.
2. Tap an existing album from a list, or pick "+ New album…" and type a name.
3. Done — the photos are uploaded in the background. They appear on the live
   site in ~1 minute (GitHub Actions resizes + thumbnails + commits to main).

The original photos are never stored on `main` — only the resized versions
the workflow produces.

---

## Before you start

You need a **GitHub Personal Access Token** with `Contents: Read and write`
scoped to `theepicuremale/moonvault`.

1. On your phone, open Safari and go to
   https://github.com/settings/personal-access-tokens/new
2. **Token name:** `OurFlix Shortcut`
3. **Expiration:** 90 days (you'll renew once a quarter).
4. **Repository access** → **Only select repositories** → pick `moonvault`.
5. **Repository permissions** → **Contents** → **Read and write**.
6. Tap **Generate token**. Copy the token (starts with `github_pat_...`).
7. Paste it somewhere you can grab when you build the shortcut below.

---

## Build the Shortcut (~5 minutes)

Open the **Shortcuts** app on your iPhone and tap **+** (top-right) to create
a new shortcut. Add these actions in order. Names match the Shortcuts app
exactly so you can search for them.

### Step 1 — Make this shortcut a Share Sheet target

1. Tap the **(i)** info button at the top of the shortcut editor.
2. Turn ON **Use with Share Sheet**.
3. Under **Share Sheet Types**, leave only **Images** and **Media** enabled.
4. Tap **Done**.

### Step 2 — Pick the album from the live manifest

Add: **Get Contents of URL**
- URL: `https://raw.githubusercontent.com/theepicuremale/moonvault/main/assets/manifest.json`
- Method: GET

Add: **Get Dictionary Value**
- Get: **Value**
- Key: `albums`
- From: the output of the previous step

Add: **Repeat with Each** (over the dictionary list)
  Inside the loop:
    Add: **Get Dictionary Value** → Key `title`, From: Repeat Item
    Add: **Add to Variable** → Variable name: `Albums`

End Repeat.

Add: **Text** action with the literal value:
```
+ New album…
```
Add: **Add to Variable** → Variable name: `Albums`
(this prepends the "new album" option to the picker)

Add: **Choose from List**
- List: `Albums` variable
- Prompt: `Album`
- Select Multiple: OFF

Add: **If** → "Chosen Item" is `+ New album…`
  Inside the If:
    Add: **Ask for Input**
    - Input type: Text
    - Prompt: `New album name`
    Add: **Set Variable** → Variable name: `Album`, Value: "Provided Input"
  Otherwise:
    Add: **Set Variable** → Variable name: `Album`, Value: "Chosen Item"
End If.

### Step 3 — Upload each shared item

Add: **Repeat with Each** (over the shortcut's input — that's the photos you
shared)
  Inside the loop:
    Add: **Get Details of Images** → File Name. (If the input is a video,
    use **Get Details of Files** → File Name; or just use a sequential name
    like `IMG_<Current Date>.jpeg`.)

    Add: **Get Contents of URL**
    - URL: `https://api.github.com/repos/theepicuremale/moonvault/contents/photos/<Album>/<filename>?ref=incoming`
      - Use the magic variable picker to insert `Album` and the filename.
    - Method: **PUT**
    - Headers:
      - `Authorization`: `Bearer <your token from above>`
      - `Accept`: `application/vnd.github+json`
      - `X-GitHub-Api-Version`: `2022-11-28`
    - Request Body: **JSON**
      - `message` (Text): `upload from phone`
      - `branch` (Text): `incoming`
      - `content` (Text): use the **Base64 Encode** action's output on the
        Repeat Item before this step.

    (Tip: insert a **Base64 Encode** action above this one with Encode set
    to "Encode" and No Line Breaks ON. Its input is the current Repeat Item.)
End Repeat.

### Step 4 — Notify

Add: **Show Notification**
- Title: `OurFlix`
- Body: `✓ Sent to "Album". Live in ~1 min.`

Save the shortcut with the name **Add to OurFlix**.

---

## Daily flow

1. Open Photos. Select 1 or more photos or videos.
2. Tap the **Share** icon.
3. Scroll down in the Share Sheet → tap **Add to OurFlix**.
4. Tap the album from the list (or "+ New album…").
5. Wait for the notification.
6. Open the site in ~1 minute — your photos are live.

---

## Troubleshooting

- **401 Unauthorized**: the token expired or was revoked. Regenerate it and
  edit the Shortcut → replace the `Authorization` header value.
- **The "Add to OurFlix" option doesn't show in Share Sheet**: open Settings
  → Shortcuts → Share Sheet and toggle the Shortcut ON. Also check the
  shortcut's `(i)` info → "Use with Share Sheet" is ON.
- **Album list is empty**: open Safari and visit
  `https://raw.githubusercontent.com/theepicuremale/moonvault/main/assets/manifest.json`
  — if that loads with JSON, the Shortcut's URL is fine; otherwise check
  spelling.
- **A file fails with 404**: the `incoming` branch may not exist yet. The
  repo admin needs to run the one-time `tools/bootstrap-incoming.ps1` script
  to create it.

---

## What happens server-side after upload

1. GitHub receives your `PUT` and creates a commit on the `incoming` branch.
2. The `.github/workflows/process-incoming.yml` workflow fires.
3. It runs `npm run build --strip-exif-on-fulls`, which:
   - Resizes your original down to ≤1600 px on the longer edge.
   - Generates a 480 px thumbnail.
   - Strips EXIF (including GPS) from the resized full.
   - Updates `assets/manifest.json` (album, date label, cover).
4. Commits the new `assets/` files to `main` as `github-actions[bot]`.
5. Force-resets `incoming` back to a placeholder README so the originals
   never linger on any branch.
6. GitHub Pages rebuilds and serves the new photos.

# "Add to OurFlix" — iOS Shortcut, tap-by-tap

Follow this list literally. Each numbered item is one tile (Action) you'll
add to the shortcut.

> Where the text says `[VariableName]`, tap the variable pill in the
> action's field and pick the variable from the list — don't type it.

---

## Before you start

1. On the phone, get a GitHub Personal Access Token (skip if you already
   have one from the +button):
   - Safari → https://github.com/settings/personal-access-tokens/new
   - Token name: `OurFlix`
   - Expiration: 90 days
   - Repository access → Only select repositories → `moonvault`
   - Permissions → **Contents** → **Read and write**
   - Generate → copy the `github_pat_...` string

2. Open the **Shortcuts** app (preinstalled on iPhone).
3. Tap **+** (top-right) → blank shortcut appears.
4. At the top, tap the current name ("New Shortcut") → rename to
   **Add to OurFlix**.

---

## Add the tiles, in order

For every step below, tap the search bar at the bottom of the editor
(it says "Search for apps and actions"), type the action name, tap it.
Then fill in the fields as listed.

### 1) Get Contents of URL
- **URL**: `https://raw.githubusercontent.com/theepicuremale/moonvault/main/assets/manifest.json`
- Leave Method: GET, Headers: empty.

### 2) Get Dictionary Value
- **Get**: Value
- **Key**: `albums`
- (The "from Contents of URL" link below it should populate automatically.)

### 3) Repeat with Each
- (No fields to fill. Drops a "Repeat with Each" container.)
- Drag this above the closing "End Repeat" line of the action so subsequent
  actions go inside the loop.

### 4) Get Dictionary Value (this one is inside the Repeat)
- **Get**: Value
- **Key**: `title`
- **Dictionary**: tap the field → pick **Repeat Item**.

### 5) Add to Variable (also inside the Repeat)
- **Variable name**: `AlbumTitles`
- (The "Input" field automatically uses the previous action's output —
  the title string. No need to change it.)

### 6) Text (after the "End Repeat" line — i.e. OUTSIDE the loop)
- **Text content**: literally `+ New album…`
  - (Three dots is the unicode "…". On iOS keyboard it's under the period key
    when you long-press; or just type "..." — both work.)

### 7) Add to Variable
- **Variable name**: `AlbumChoices`
- (Input is the **Text** from step 6.)

### 8) Add to Variable
- **Variable name**: `AlbumChoices`
- **Input**: tap the input pill → **Select Variable** → pick `AlbumTitles`.

### 9) Choose from List
- **List**: tap → Select Variable → `AlbumChoices`
- Expand the action (chevron) → **Prompt**: `Album`
- **Select Multiple**: OFF

### 10) If
- Tap the **Condition** dropdown → **is**.
- Left field (Input): tap → Select Variable → **Chosen Item**.
- Right field: type `+ New album…` (same exact text as step 6).
- The action expands into "If ... Otherwise ... End If".

### 11) (Inside the If, before Otherwise) — Ask for Input
- **Input Type**: Text
- **Prompt**: `New album name`
- **Default Answer**: leave blank.

### 12) (Inside the If, after step 11) — Set Variable
- **Variable name**: `Album`
- **Input**: tap → Select Variable → **Provided Input**.

### 13) (After "Otherwise", before "End If") — Set Variable
- **Variable name**: `Album`
- **Input**: tap → Select Variable → **Chosen Item**.

### 13a) (AFTER "End If") — URL Encode
- Album names can contain spaces (e.g. `Shadow Realm`) which break URLs.
- Search: **URL Encode** → tap it.
- **Encode**: `Encode` (not Decode)
- **Input**: tap → Select Variable → **Album**.

### 13b) Set Variable (overwrite Album with the encoded form)
- **Variable name**: `Album` (same name — we're replacing it)
- **Input**: tap → Select Variable → **URL Encoded** (output of 13a).

### 14) Repeat with Each (AFTER step 13b)
- **Input**: tap → Select Variable → **Shortcut Input** (the photos that
  were shared).
- Inside this Repeat, add steps 15-18.

### 15) (Inside this Repeat) — Base64 Encode
- **Encode**: Encode (not Decode)
- **Line Break**: tap to set → **No Line Breaks**
- **Input**: leave as Repeat Item (the photo file).

### 16) (Inside this Repeat) — Get Details of Images
- (If "Get Details of Images" isn't available for videos, use **Get
  Details of Files** instead.)
- **Get**: **Name**
- **Input**: tap → Select Variable → **Repeat Item**.

### 17) (Inside this Repeat) — Text  (build the URL into a variable)
- Search: **Text** → tap it.
- Content (with two variable pills):
  ```
  https://api.github.com/repos/theepicuremale/moonvault/contents/photos/[Album]/[Name]
  ```
  - `[Album]` = Select Variable → `Album`
  - `[Name]` = Select Variable → **Name** (output of step 16).
- Tap the action's chevron → **Custom Output Name** → set to `RequestURL`.

### 18) (Inside this Repeat) — Get Contents of URL
- **URL**: tap → Select Variable → **RequestURL** (output of step 17).
- Tap **Show More** (under the URL field) to reveal the rest:
  - **Method**: PUT
  - **Headers**: tap +, add three rows:
    - `Authorization` → value: `Bearer github_pat_YOUR_TOKEN_HERE`
      (paste the actual token after "Bearer " — including the prefix)
    - `Accept` → value: `application/vnd.github+json`
    - `X-GitHub-Api-Version` → value: `2022-11-28`
  - **Request Body**: tap → **JSON** (NOT File — File mode can choke on
    multi-megabyte base64 strings and the response comes back unparseable).
    - Tap **Add new field** three times and fill in:
      - Field 1 (Text): Key `message`, Value `upload from iOS`
      - Field 2 (Text): Key `content`, Value = Select Variable → **Base64
        Encoded** (output of step 15). The value cell must contain ONLY
        the variable pill, no text around it.
      - Field 3 (Text): Key `branch`, Value `incoming`

### 18a) (Inside the photo Repeat, immediately after step 18) — Get Dictionary Value
- **Get**: Value
- **Key**: `message`
- **Dictionary**: tap → Select Variable → **Contents of URL** (output of step 18).

### 18b) (Inside the photo Repeat) — If
- **Input**: tap → Select Variable → **Dictionary Value** (output of 18a).
- **Condition**: `has any value`.
- (The action expands into "If … Otherwise … End If".)

### 18c) (Inside the If, before Otherwise) — Text   [DEBUG: includes URL + raw response]
- Content (with four variable pills, on separate lines):
  ```
  ✗ [Name]: [Dictionary Value]
  URL: [RequestURL]
  Resp: [Contents of URL]
  ```
  - `[Name]` = Select Variable → **Name** (output of step 16).
  - `[Dictionary Value]` = Select Variable → **Dictionary Value** (output of 18a).
  - `[RequestURL]` = Select Variable → **RequestURL** (output of 17a).
  - `[Contents of URL]` = Select Variable → **Contents of URL** (output of 18).

### 18d) (Inside the If, right after 18c) — Add to Variable
- **Variable name**: `Report`
- (Input is auto-filled with the Text from 18c.)

### 18e) (After "Otherwise", before "End If") — Text   [DEBUG: includes URL + raw response]
- Content (three pills, on separate lines):
  ```
  ✓ [Name]
  URL: [RequestURL]
  Resp: [Contents of URL]
  ```
  - `[Name]` = Select Variable → **Name**.
  - `[RequestURL]` = Select Variable → **RequestURL**.
  - `[Contents of URL]` = Select Variable → **Contents of URL**.

### 18f) (After 18e, still before "End If") — Add to Variable
- **Variable name**: `Report`
- (Input is auto-filled with the Text from 18e.)

### 19) (AFTER "End Repeat" — outside both loops) — Combine Text
- **Input**: tap → Select Variable → `Report`.
- **Separator**: tap → **New Lines**.

### 19a) Copy to Clipboard   [DEBUG: full report is too long for a notification, so we stash it on the clipboard]
- Search: **Copy to Clipboard** → tap it.
- **Input**: tap → Select Variable → **Combined Text** (output of step 19).
- Open the Notes app or Messages after the shortcut runs and paste — you'll
  see the complete URL + response per file.

### 20) Show Notification
- **Title**: `OurFlix`
- **Body**: tap → Select Variable → **Combined Text** (output of step 19).

The notification will show truncated debug info (iOS notifications are
short). For the full report, tap into any text field after the shortcut
runs and paste.

Per-file notification lines look like:
- Success:
  ```
  ✓ <GUID>.HEIC
  URL: https://api.github.com/repos/.../photos/Shadow%20Realm/<GUID>.HEIC
  Resp: {"content":{"name":"<GUID>.HEIC","path":"photos/Shadow Realm/<GUID>.HEIC",...
  ```
- Failure:
  ```
  ✗ <GUID>.HEIC: Bad credentials
  URL: https://api.github.com/repos/.../photos/Shadow%20Realm/<GUID>.HEIC
  Resp: {"message":"Bad credentials","documentation_url":"..."}
  ```

> When you're done debugging, you can simplify steps 18c / 18e back to a
> single `✓ Name` / `✗ Name: message` line, and delete step 19a.

---

## Make it a Share Sheet target

At the bottom of the editor, tap the **(i)** info icon.

1. Toggle **Show in Share Sheet** ON.
2. **Share Sheet Types**: uncheck everything except **Images** and **Media**.
3. Tap **Done** (top-right) to close info.
4. Tap **Done** (top-right) again to save the shortcut.

---

## Use it

1. Photos app → tap a photo (or multi-select).
2. **Share** icon (square with arrow).
3. Scroll the Share Sheet down → tap **Add to OurFlix**.
4. The first time it runs it asks "Allow Add to OurFlix to access
   api.github.com?" → **Always Allow**.
5. Pick an album from the list (or "+ New album…" and type a name).
6. Wait ~1 second per file. When the notification says
   "Sent. Live in ~1 min." you're done.
7. Open OURFLIX in ~1 minute — your photos are there.

---

## Troubleshooting

- **401 Unauthorized**: your token expired. Regenerate (Before-You-Start
  section), then edit the Shortcut → step 18 → Headers → replace the
  Authorization value.

- **Shortcut not in Share Sheet**: Settings → Shortcuts → Share Sheet →
  toggle "Add to OurFlix" ON. Also confirm the editor's (i) panel has
  "Show in Share Sheet" ON.

- **Album list is empty**: open Safari and visit
  https://raw.githubusercontent.com/theepicuremale/moonvault/main/assets/manifest.json
  If JSON loads, the Shortcut URL is fine. If it doesn't, double-check
  step 1's URL spelling.

- **404 on upload**: the `incoming` branch may have been deleted. Run
  `tools/bootstrap-incoming.ps1` from your laptop to recreate it.

- **HEIC photos**: supported. The server converts them to JPEG.

---

## Backend: identical to the +button

Both the Shortcut and the in-OURFLIX +button PUT to the same `incoming`
branch via the same GitHub Contents API endpoint. The
`.github/workflows/process-incoming.yml` workflow then runs the build
(resize, thumb, EXIF strip, HEIC→JPEG, manifest update), commits to
`main`, and force-resets `incoming` back to a clean placeholder.

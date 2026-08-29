# Add to OurFlix — iOS Shortcut

The repository is private. Every GitHub request must include the token header;
the public `raw.githubusercontent.com` manifest URL will not work.

GitHub's Contents and Git Blobs APIs reject a single file above 100 MiB. For
videos above 16 MiB, the website uploader automatically uses retryable 12 MiB
chunks. The server reconstructs the original and compresses videos above
95 MiB before publishing.

## Give this prompt to Siri / Apple Intelligence

Replace `[GITHUB_TOKEN]` first, then send the entire block:

```text
Create an iPhone Shortcut named "Add to OurFlix".

It must appear in the Share Sheet and accept multiple Images and Media files.
If it is run without Share Sheet input, use "Select Photos" with multiple
selection enabled.

Ask for Text with the prompt "OurFlix album name". Save the answer as Album.

Repeat with each selected media file, sequentially:
1. Get the file name of Repeat Item and save it as FileName.
2. URL-encode Album and FileName separately.
3. Base64 Encode Repeat Item with no line breaks. Encode the actual file bytes,
   not its name or URL.
4. Use Get Contents of URL:
   URL:
   https://api.github.com/repos/theepicuremale/moonvault/contents/photos/{URL-encoded Album}/{URL-encoded FileName}
   Method: PUT
   Headers:
   Authorization: Bearer [GITHUB_TOKEN]
   Accept: application/vnd.github+json
   X-GitHub-Api-Version: 2022-11-28
   Request Body: JSON
   JSON text fields:
   message = upload from iOS: {Album} / {FileName}
   content = the Base64 Encoded variable only
   branch = incoming
5. If the response contains a content.sha value, append "✓ {FileName}" to a
   Report variable. Otherwise append "✗ {FileName}: {complete response}".
6. Wait 1 second before the next file.

After the repeat, combine Report with new lines, copy it to the clipboard, and
show it in a notification titled "OurFlix upload".

Do not place base64 in the URL. Do not use a public raw.githubusercontent.com
URL. Do not run uploads in parallel.
```

## Required token

Create a fine-grained token here:

<https://github.com/settings/personal-access-tokens/new>

Configure:

- Repository access: **Only select repositories** → `moonvault`
- Repository permission: **Contents** → **Read and write**

Keep the token only inside the Shortcut. Never paste it into chat, notes,
screenshots, or source code.

## Optional authenticated album-list URL

The minimal Shortcut above asks for the album name because that is the most
reliable Siri-generated version. To fetch the album list dynamically, use:

```text
https://api.github.com/repos/theepicuremale/moonvault/contents/assets/manifest.json?ref=main
```

That GET request also requires:

```text
Authorization: Bearer [GITHUB_TOKEN]
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

GitHub returns the manifest in the response's `content` field as base64. Remove
line breaks, Base64 Decode it, parse it as JSON, then read `albums[].title`.

## How the backend handles multiple files

The Shortcut intentionally uploads files one at a time. GitHub creates one
commit for each file, but the server keeps later commits safe while an earlier
workflow is running. The latest queued workflow processes all files still on
the `incoming` branch. The branch is reset only when no newer upload commit
exists.

If an image or video cannot be processed, the workflow fails visibly but clears
that completed batch so it cannot block later uploads. Correct the file and
upload it again. If the processing job itself is interrupted before reaching a
safe completion point, the originals stay on `incoming` for retry.

## Troubleshooting

- **401 / Bad credentials:** replace the expired token.
- **404:** confirm the token can access the private `moonvault` repository.
- **422 / SHA was not supplied:** a file with the same path is already waiting
  on `incoming`; wait for processing to finish, then retry.
- **Blob is too large:** the Shortcut cannot send GitHub files above 100 MiB.
  Upload that video from the OurFlix website instead.
- **No GitHub Actions run appears:** the request failed on the phone before
  GitHub accepted it. Copy the Report from the clipboard and inspect the full
  response.
- **Run succeeds but media is not visible:** reload OurFlix. Albums and media
  are ordered by upload time, so the updated album and newest media appear
  first.

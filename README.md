# moonvault 🌙

This is a personal, private little corner of the internet — built by me, for me and mine. It is **not** a template, not a tutorial, and not meant to be reused.

**Live (gated):** https://theepicuremale.github.io/moonvault/

## What this is

A tiny interactive page that opens up only for a small allowlist of people. Anyone else lands on a polite "not for you" wall. The contents inside are personal — inside jokes, our song, our GIFs, things meant only for us.

## Please don't copy this

If you stumbled here from search or a link:

- **Don't fork it.** The text, music, GIFs, allowlist, and overall vibe are tailored for one specific person. Cloning it just hands them somebody else's love letter with the name changed.
- **Don't lift the code wholesale.** It's intentionally simple — if you want to make something for someone, make *your* version, not mine.
- **Don't try to bypass the gate.** It's there on purpose.

If you genuinely want to build something similar for someone you care about, build it yourself from scratch. The whole point is that it's *yours*.

## Notes to future me

- IP allowlist + passcode escape hatch live in `auth.js` and `blocked.html`. Keep `PASSCODE` in sync between the two.
- Initial `<title>` on every gated page is the "not for you" wall; `auth.js` flips it to the real title (read from `data-real-title` on `<html>`) only after auth passes — that way unauthorized eyes never see the real title flash in the tab.
- Music in `music/` is the one *we* know. Don't replace casually.
- Pages source: `main` branch, `/` (root). Public repo (Free plan), so contents are technically world-readable in git — keep nothing truly sensitive here.

## License

All rights reserved. Personal project — no license granted to copy, redistribute, or reuse.

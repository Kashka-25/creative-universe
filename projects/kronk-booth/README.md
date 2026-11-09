# Kronk Booth — notes

Kronk Booth is Cassidy's contribution to Kronk, a community platform maintained by Cassidy's friend Tal (GitHub: talitamoss). The goal is to make the Booth (kronk.info/hub/booth) tidier and more useful for musicians, and to add live sets. The code lives in Tal's repo, so these notes live here instead.

- **Upstream:** Kronkverse/kronk (default branch `shadow`). Kashka-25 has read-only access: Tal handles merges, staging and releases.
- **Fork and clone:** Kashka-25/kronk, at `C:\Users\cassi\Projects\Kronk-Booth`.
- **Direction:** not a Spotify copy. Lift new voices, support musicians outside corrupt systems, and use Kronk branding.

## Sharing permission

On 9 Nov 2026 Cassidy confirmed permission to show Kronk, the Booth and the Marketplace (Wachuneed) in Creative Universe as a collaborative feature project. The cards are `content/works/kronk.json` (Digital, also listed in Music) and `content/works/wachuneed.json` (card only).

## Done

| PR | What | State |
| --- | --- | --- |
| #2127 | Booth tidy | Merged 13 Oct 2026 |
| #2339 | Live sets and listening tools (My sets, saves, kinds, sort, play next, Remind me, Shoutouts, First listens, live banner) | Merged 23 Oct 2026 |
| #1988, #2010 | FreeTheDream korner (the map inside Kronk) | Merged Oct 2026 |

## Built locally, not opened yet (open one at a time, each after the previous merges)

1. `feature/booth-vibe-circle`: browse by feeling, intensity, together and moment.
2. `feature/booth-krates-kollab`: Krates and Kollab.
3. `feature/booth-story-support`: the story behind a set, plus Support the artist. Support sits behind the `booth_support` flag and waits on a Kommons decision.

Before each PR, rebase onto `upstream/shadow`. The next step is a message to Tal.

## Waiting on others

- Kalendar link: needs Tal to agree a shared `korner_attachments` change.
- Support the artist: needs a Kommons donate proposal.

## Links

- [Prototype](https://claude.ai/artifact/3rfpGQoeaMHZDTwAswnZfp)
- [Call board](https://claude.ai/artifact/3qseYDyc12kU4exLGTHnib)
- [Design brief](https://claude.ai/artifact/PEquUG3qzTWhXULgAoqPbq)

# Chess Weakness Finder

A web app that analyzes a chess player's recent games and reports where their
mistakes actually happen — by game phase and by opening. Pick a site
([Lichess](https://lichess.org) or [Chess.com](https://chess.com)), enter a
username, and the app pulls their recent blitz games, runs each move through the
Stockfish engine, and produces a weakness report.

Stockfish runs **in the visitor's browser** (`static/`), so the site is pure
static files: no server, no hosting bill, and it scales for free.
(`app.py` is the original server-side FastAPI version, kept for reference.)

## What it does

- Fetches a player's recent blitz and/or rapid games from the Lichess or
  Chess.com public API (5–100 games)
- Evaluates every move with Stockfish and flags **mistakes** and
  **inaccuracies** by how much they cut the player's winning chances (the same
  model Lichess uses), so slips in already-won or already-lost positions don't
  inflate the count
- Builds a report:
  - The player's **top 3 recurring weaknesses** (hanging pieces, missed
    tactics, endgame technique, opening mistakes, positional slips), each with
    a tip and a training link
  - How many mistakes came in **time trouble**, per game phase
  - **Board diagrams of the biggest mistakes** (move played vs. engine's best)
  - Which **openings** produce the most mistakes and losses
- **Sharing:** every report has a link that re-runs it (`?u=name&site=lichess`)
  and a 1200×630 summary image for social posts

## Running it locally

```bash
npm start            # serves static/ at http://127.0.0.1:8000
npm test             # unit tests (Node 18+, no dependencies)
```

## Deploying (free)

Any static host works. With **Cloudflare Pages** (free, works with private repos):
connect the GitHub repo, leave the build command empty, set the output
directory to `static`. Then set `siteUrl` in `static/config.js` to the live URL.

## Monetization settings

Everything revenue-related lives in `static/config.js`, and each feature stays
hidden until it's filled in:

| Setting | What it does |
| --- | --- |
| `resources` | Training link under each weakness — swap in affiliate URLs |
| `tipUrl` | "Support the project" link in the report footer (Ko-fi, Buy Me a Coffee…) |
| `newsletter.formAction` | Email signup under the weaknesses (e.g. Buttondown embed URL) |
| `plausibleDomain` | Privacy-friendly analytics, with events for analyses, shares, signups and affiliate clicks |

## Notes

- Both the Lichess and Chess.com APIs require a `User-Agent` header — requests
  without one can be rejected. If you make requests too quickly you'll get a 429
  (rate limit); wait a minute and try again.
- Chess.com has no "recent N games" endpoint, so the app walks the player's
  monthly archives newest-first until it has enough blitz games.
- Opening names come from the PGN `Opening` header (Lichess) or are derived from
  the `ECOUrl` header (Chess.com).
- Lichess rejects requests with some automated User-Agents (curl, headless
  Chrome). Normal browsers are fine.

## Roadmap / ideas

- ~~Support rapid in addition to blitz~~ ✅ done (classical still TODO)
- ~~Support Chess.com in addition to Lichess~~ ✅ done
- ~~Let the user choose how many games to analyze~~ ✅ done (5 / 10 / 25 / 50 / 100)
- ~~Show the specific positions where mistakes happened~~ ✅ done (board diagrams)
- Compare two players side by side
- Cache results so repeat lookups are instant
- Track a player's weaknesses over time (re-check monthly)

# Chess Weakness Finder

A web app that analyzes a chess player's recent games and reports where their
mistakes actually happen — by game phase and by opening. Pick a site
([Lichess](https://lichess.org) or [Chess.com](https://chess.com)), enter a
username, and the app pulls their recent blitz games, runs each move through the
Stockfish engine, and produces a weakness report.

Built with Python, FastAPI, and the Stockfish chess engine.

## What it does

- Fetches a player's recent blitz **and rapid** games from the Lichess or
  Chess.com public API (choose 5, 25, 50, or 100 games)
- Evaluates every move with Stockfish to detect **mistakes** (large eval swings)
  and **inaccuracies** (smaller ones)
- Aggregates the results into a report:
  - Total mistakes and inaccuracies, and average per game
  - Which **phase** (opening / middlegame / endgame) mistakes cluster in
  - Which **openings** produce the most mistakes
  - Which **openings** the player loses in most
  - **Board diagrams of the biggest mistakes** — each position is shown with an
    arrow for the move played (red) vs. the engine's best move (green), plus the
    eval before and after

## Tech stack

- **Python 3**
- **FastAPI** — web framework
- **python-chess** — PGN parsing and Stockfish engine communication
- **Stockfish** — chess engine that evaluates each position
- **Jinja2** — HTML templates

## How it works

1. `app.py` calls the Lichess API (or, for Chess.com, walks the player's monthly
   game archives) to download recent blitz games as PGN.
2. Each game is replayed move by move on a `chess.Board`.
3. After each move, Stockfish evaluates the position (in centipawns).
4. If the evaluation swings against the player by more than a threshold, the
   move is flagged as a mistake or inaccuracy.
5. Flags are grouped by game phase and opening to build the final report.

## Running it locally

**Prerequisites:** Python 3 and Stockfish installed and on your `PATH`.

```bash
# macOS
brew install stockfish
```

```bash
# Set up the project
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Start the server
uvicorn app:app --reload
```

Then open http://127.0.0.1:8000, pick a site, and enter a username.

> Stockfish evaluates every position, so analysis takes ~30–60 seconds for 5
> games and a few minutes for 100. Larger batches automatically use a shorter
> per-move analysis time to keep the total runtime reasonable.

## Notes

- Both the Lichess and Chess.com APIs require a `User-Agent` header — requests
  without one can be rejected. If you make requests too quickly you'll get a 429
  (rate limit); wait a minute and try again.
- Chess.com has no "recent N games" endpoint, so the app walks the player's
  monthly archives newest-first until it has enough blitz games.
- Opening names come from the PGN `Opening` header (Lichess) or are derived from
  the `ECOUrl` header (Chess.com).
- To analyze more games or other time controls, adjust `num_games` and the
  time-control filter in `app.py`.

## Roadmap / ideas

- ~~Support rapid in addition to blitz~~ ✅ done (classical still TODO)
- ~~Support Chess.com in addition to Lichess~~ ✅ done
- ~~Let the user choose how many games to analyze~~ ✅ done (5 / 10 / 25 / 50 / 100)
- ~~Show the specific positions where mistakes happened~~ ✅ done (board diagrams)
- Compare two players side by side
- Cache results so repeat lookups are instant

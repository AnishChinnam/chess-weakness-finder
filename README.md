# Chess Weakness Finder

A web app that analyzes a chess player's recent games and reports where their
mistakes actually happen — by game phase and by opening. Enter any
[Lichess](https://lichess.org) username, and the app pulls their recent blitz
games, runs each move through the Stockfish engine, and produces a
weakness report.

Built with Python, FastAPI, and the Stockfish chess engine.

## What it does

- Fetches a player's recent blitz games from the Lichess public API
- Evaluates every move with Stockfish to detect **mistakes** (large eval swings)
  and **inaccuracies** (smaller ones)
- Aggregates the results into a report:
  - Total mistakes and inaccuracies, and average per game
  - Which **phase** (opening / middlegame / endgame) mistakes cluster in
  - Which **openings** produce the most mistakes
  - Which **openings** the player loses in most

## Tech stack

- **Python 3**
- **FastAPI** — web framework
- **python-chess** — PGN parsing and Stockfish engine communication
- **Stockfish** — chess engine that evaluates each position
- **Jinja2** — HTML templates

## How it works

1. `app.py` calls the Lichess API to download games as PGN.
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

Then open http://127.0.0.1:8000 and enter a Lichess username.

> Analysis takes 30–60 seconds because Stockfish evaluates every position.

## Notes

- The Lichess API requires a `User-Agent` header — requests without one get a
  404. If you make requests too quickly you'll get a 429 (rate limit); wait a
  minute and try again.
- To analyze more games or other time controls, adjust `num_games` and
  `perfType` in `app.py`.

## Roadmap / ideas

- Support other time controls (rapid, classical) via a dropdown
- Show the specific positions where mistakes happened
- Compare two players side by side
- Cache results so repeat lookups are instant

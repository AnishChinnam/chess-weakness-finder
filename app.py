from fastapi import FastAPI, Request, Form
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
import os
import requests
import chess
import chess.pgn
import chess.engine
import chess.svg
import io
from collections import Counter

app = FastAPI()
templates = Jinja2Templates(directory="templates")

# Both APIs require a descriptive User-Agent, otherwise they can reject requests.
USER_AGENT = "chess-weakness-finder (github.com/your-username)"

SITE_NAMES = {"lichess": "Lichess", "chesscom": "Chess.com"}

# Which time classes each choice includes, for filtering Chess.com games.
TIME_CONTROLS = {
    "blitz": ("blitz",),
    "rapid": ("rapid",),
    "both": ("blitz", "rapid"),
}
# Human-readable label used in reports and error messages.
TIME_CONTROL_LABELS = {"blitz": "blitz", "rapid": "rapid", "both": "blitz & rapid"}


def fetch_lichess_pgn(username: str, num_games: int, time_control: str = "both"):
    """Return (pgn_text, error) for a Lichess user's recent games."""
    url = f"https://lichess.org/api/games/user/{username}"
    headers = {
        "Accept": "application/x-chess-pgn",
        "User-Agent": USER_AGENT,
    }
    token = os.environ.get("LICHESS_TOKEN", "")
    if token:
        headers["Authorization"] = "Bearer " + token
    # perfType accepts a comma-separated list; opening=true adds the Opening header.
    perf_type = ",".join(TIME_CONTROLS.get(time_control, TIME_CONTROLS["both"]))
    params = {"max": num_games, "perfType": perf_type, "opening": "true"}

    response = requests.get(url, headers=headers, params=params)

    if response.status_code == 429:
        return None, "Lichess rate limit hit. Please wait a minute and try again."
    if response.status_code != 200 or not response.text.strip().startswith("["):
        return None, f"Could not find Lichess games for '{username}'. Check the username and try again."
    return response.text, None


def fetch_chesscom_pgn(username: str, num_games: int, time_control: str = "both"):
    """Return (pgn_text, error) for a Chess.com user's recent games.

    Chess.com serves games as monthly archives. We walk the archive list from
    the most recent month backwards, collecting games of the requested time
    class(es) until we have enough, then concatenate their PGNs so python-chess
    can read them in sequence.
    """
    headers = {"User-Agent": USER_AGENT}
    archives_url = f"https://api.chess.com/pub/player/{username}/games/archives"
    allowed_classes = TIME_CONTROLS.get(time_control, TIME_CONTROLS["both"])

    resp = requests.get(archives_url, headers=headers)
    if resp.status_code == 404:
        return None, f"Could not find Chess.com user '{username}'. Check the username and try again."
    if resp.status_code == 429:
        return None, "Chess.com rate limit hit. Please wait a minute and try again."
    if resp.status_code != 200:
        return None, "Chess.com API error. Please try again in a moment."

    archives = resp.json().get("archives", [])
    if not archives:
        return None, f"No games found for Chess.com user '{username}'."

    pgns = []
    # Archives are oldest-first; walk newest month first.
    for month_url in reversed(archives):
        r = requests.get(month_url, headers=headers)
        if r.status_code != 200:
            continue
        games = r.json().get("games", [])
        # Within a month, games are oldest-first too; take the newest first.
        for game in reversed(games):
            if (
                game.get("time_class") in allowed_classes
                and game.get("rules") == "chess"
                and game.get("pgn")
            ):
                pgns.append(game["pgn"])
                if len(pgns) >= num_games:
                    break
        if len(pgns) >= num_games:
            break

    if not pgns:
        label = TIME_CONTROL_LABELS.get(time_control, "blitz & rapid")
        return None, f"No {label} games found for Chess.com user '{username}'."
    return "\n\n".join(pgns), None


def opening_name(game) -> str:
    """Best-effort opening name that works for both Lichess and Chess.com PGNs."""
    opening = game.headers.get("Opening")
    if opening and opening != "?":
        return opening
    # Chess.com PGNs carry an ECOUrl like
    # https://www.chess.com/openings/Sicilian-Defense-Najdorf-Variation
    eco_url = game.headers.get("ECOUrl", "")
    if eco_url:
        slug = eco_url.rstrip("/").split("/")[-1]
        if slug:
            return slug.replace("-", " ")
    return game.headers.get("ECO", "Unknown")


def format_eval(cp: int) -> str:
    """Format a centipawn score (player POV) as a readable string."""
    if cp >= 9000:
        return "+M"
    if cp <= -9000:
        return "-M"
    return f"{cp / 100:+.1f}"


def severity(swing: int) -> str:
    """Label a mistake by how much eval it threw away (in centipawns)."""
    if swing >= 500:
        return "Blunder"
    if swing >= 300:
        return "Big mistake"
    return "Mistake"


def render_board_svg(mistake: dict) -> str:
    """Render the position before the mistake, with arrows for the move played
    (red) and the engine's best move (green), oriented to the player's side."""
    board = chess.Board(mistake["fen_before"])
    arrows = []
    played = chess.Move.from_uci(mistake["played_uci"])
    arrows.append(chess.svg.Arrow(played.from_square, played.to_square, color="#e5534b"))
    if mistake["best_uci"]:
        best = chess.Move.from_uci(mistake["best_uci"])
        arrows.append(chess.svg.Arrow(best.from_square, best.to_square, color="#57ab5a"))
    orientation = chess.WHITE if mistake["orientation"] else chess.BLACK
    return chess.svg.board(board, orientation=orientation, arrows=arrows,
                           size=320, coordinates=True)


def decorate_mistake(mistake: dict) -> dict:
    """Add display-ready fields (SVG, formatted evals, severity) to a mistake."""
    return {
        **mistake,
        "svg": render_board_svg(mistake),
        "played_eval_str": format_eval(mistake["played_eval"]),
        "best_eval_str": format_eval(mistake["best_eval"]),
        "severity": severity(mistake["swing"]),
    }


def analyze_player(username: str, site: str = "lichess", num_games: int = 5,
                   time_control: str = "both", time_per_move: float = 0.1):
    """Pull games from the chosen site and return a weakness report as a dict."""

    if time_control not in TIME_CONTROLS:
        time_control = "both"

    if site == "chesscom":
        pgn_text, error = fetch_chesscom_pgn(username, num_games, time_control)
    else:
        site = "lichess"
        pgn_text, error = fetch_lichess_pgn(username, num_games, time_control)

    if error:
        return {"error": error}

    pgn_io = io.StringIO(pgn_text)
    engine = chess.engine.SimpleEngine.popen_uci("stockfish")

    total_mistakes = 0
    total_inaccuracies = 0
    mistakes_by_phase = Counter()
    mistakes_by_opening = Counter()
    losing_openings = Counter()
    key_mistakes = []
    games_analyzed = 0

    def get_phase(move_number):
        if move_number <= 12:
            return "opening"
        elif move_number <= 30:
            return "middlegame"
        return "endgame"

    while True:
        game = chess.pgn.read_game(pgn_io)
        if game is None:
            break

        games_analyzed += 1
        white = game.headers.get("White", "?")
        result = game.headers.get("Result", "?")
        opening = opening_name(game)

        user_is_white = white.lower() == username.lower()
        user_lost = (user_is_white and result == "0-1") or (not user_is_white and result == "1-0")

        if user_lost:
            losing_openings[opening] += 1

        board = game.board()
        move_number = 0
        # Analyse the starting position so we know the eval AND the best move
        # for the position the player is about to move in. For any move, the
        # position "before" it is the one we analysed on the previous ply, so
        # this costs only one extra engine call per game.
        prev_info = engine.analyse(board, chess.engine.Limit(time=time_per_move))
        previous_eval = prev_info["score"].white().score(mate_score=10000) or 0

        for move in game.mainline_moves():
            move_number += 1
            board_before = board.copy()
            # Best move in the position the player actually faced.
            pv = prev_info.get("pv") or []
            best_move = pv[0] if pv else None

            board.push(move)
            info = engine.analyse(board, chess.engine.Limit(time=time_per_move))
            score = info["score"].white().score(mate_score=10000)
            if score is None:
                prev_info = info
                continue

            eval_change = score - previous_eval
            white_just_moved = board.turn == chess.BLACK

            is_mistake = False
            is_inaccuracy = False

            if white_just_moved and user_is_white:
                if eval_change < -200:
                    is_mistake = True
                elif eval_change < -100:
                    is_inaccuracy = True
            elif not white_just_moved and not user_is_white:
                if eval_change > 200:
                    is_mistake = True
                elif eval_change > 100:
                    is_inaccuracy = True

            if is_mistake:
                total_mistakes += 1
                mistakes_by_phase[get_phase(move_number)] += 1
                mistakes_by_opening[opening] += 1

                # Evals from the player's point of view (positive = good for them).
                sign = 1 if user_is_white else -1
                key_mistakes.append({
                    "game_num": games_analyzed,
                    "move_number": move_number,
                    "phase": get_phase(move_number),
                    "opening": opening,
                    "fen_before": board_before.fen(),
                    "played_uci": move.uci(),
                    "best_uci": best_move.uci() if best_move else None,
                    "played_san": board_before.san(move),
                    "best_san": board_before.san(best_move) if best_move else "?",
                    "played_eval": sign * score,        # eval after the move played
                    "best_eval": sign * previous_eval,  # eval had they played best
                    "swing": abs(eval_change),
                    "orientation": user_is_white,
                })
            elif is_inaccuracy:
                total_inaccuracies += 1

            previous_eval = score
            prev_info = info

    engine.quit()

    if games_analyzed == 0:
        label = TIME_CONTROL_LABELS.get(time_control, "blitz & rapid")
        return {"error": f"No {label} games found for '{username}' on {SITE_NAMES.get(site, site)}."}

    # Show the worst handful of mistakes as board diagrams (biggest eval swings).
    key_mistakes.sort(key=lambda m: m["swing"], reverse=True)
    top_mistakes = [decorate_mistake(m) for m in key_mistakes[:8]]

    return {
        "username": username,
        "site": SITE_NAMES.get(site, site),
        "time_control": TIME_CONTROL_LABELS.get(time_control, "blitz & rapid"),
        "games_analyzed": games_analyzed,
        "total_mistakes": total_mistakes,
        "total_inaccuracies": total_inaccuracies,
        "avg_mistakes": round(total_mistakes / games_analyzed, 1),
        "phase_breakdown": dict(mistakes_by_phase.most_common()),
        "worst_openings": mistakes_by_opening.most_common(5),
        "losing_openings": losing_openings.most_common(5),
        "key_mistakes": top_mistakes,
    }


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(request, "home.html")


# Allowed game-count choices, and how much time Stockfish gets per move for
# each. Bigger batches use less time per move so the whole run stays reasonable
# (100 games at 0.1s/move would take many minutes).
GAME_COUNT_TIME = {5: 0.1, 10: 0.1, 25: 0.08, 50: 0.05, 100: 0.03}


@app.post("/analyze", response_class=HTMLResponse)
async def analyze(
    request: Request,
    username: str = Form(...),
    site: str = Form("lichess"),
    time_control: str = Form("both"),
    num_games: int = Form(5),
):
    # Clamp to a supported choice; fall back to 5 if someone sends anything else.
    if num_games not in GAME_COUNT_TIME:
        num_games = 5
    report = analyze_player(
        username,
        site=site,
        num_games=num_games,
        time_control=time_control,
        time_per_move=GAME_COUNT_TIME[num_games],
    )
    return templates.TemplateResponse(request, "report.html", {"report": report})

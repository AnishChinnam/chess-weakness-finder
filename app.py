from fastapi import FastAPI, Request, Form
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
import os
import requests
import chess
import chess.pgn
import chess.engine
import io
from collections import Counter

app = FastAPI()
templates = Jinja2Templates(directory="templates")


def analyze_player(username: str, num_games: int = 5, time_per_move: float = 0.1):
    """Pull games and return a weakness report as a dict."""
    
    url = f"https://lichess.org/api/games/user/{username}"
    # Lichess requires a User-Agent header, otherwise it returns a 404 HTML page.
    headers = {
        "Accept": "application/x-chess-pgn",
        "User-Agent": "chess-weakness-finder (github.com/your-username)",
    }
    token = os.environ.get("LICHESS_TOKEN", "")
    if token:
        headers["Authorization"] = "Bearer " + token
    # opening=true tells Lichess to include the Opening header in the PGN.
    params = {"max": num_games, "perfType": "blitz", "opening": "true"}

    response = requests.get(url, headers=headers, params=params)

    if response.status_code == 429:
        return {"error": "Lichess rate limit hit. Please wait a minute and try again."}
    if response.status_code != 200 or not response.text.strip().startswith("["):
        return {"error": f"Could not find games for '{username}'. Check the username and try again."}
    
    pgn_io = io.StringIO(response.text)
    engine = chess.engine.SimpleEngine.popen_uci("stockfish")
    
    total_mistakes = 0
    total_inaccuracies = 0
    mistakes_by_phase = Counter()
    mistakes_by_opening = Counter()
    losing_openings = Counter()
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
        opening = game.headers.get("Opening", "Unknown")
        
        user_is_white = white.lower() == username.lower()
        user_lost = (user_is_white and result == "0-1") or (not user_is_white and result == "1-0")
        
        if user_lost:
            losing_openings[opening] += 1
        
        board = game.board()
        move_number = 0
        previous_eval = 0
        
        for move in game.mainline_moves():
            move_number += 1
            board.push(move)
            
            info = engine.analyse(board, chess.engine.Limit(time=time_per_move))
            score = info["score"].white().score(mate_score=10000)
            if score is None:
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
            elif is_inaccuracy:
                total_inaccuracies += 1
            
            previous_eval = score
    
    engine.quit()
    
    if games_analyzed == 0:
        return {"error": f"No blitz games found for '{username}'."}
    
    return {
        "username": username,
        "games_analyzed": games_analyzed,
        "total_mistakes": total_mistakes,
        "total_inaccuracies": total_inaccuracies,
        "avg_mistakes": round(total_mistakes / games_analyzed, 1),
        "phase_breakdown": dict(mistakes_by_phase.most_common()),
        "worst_openings": mistakes_by_opening.most_common(5),
        "losing_openings": losing_openings.most_common(5),
    }


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(request, "home.html")


@app.post("/analyze", response_class=HTMLResponse)
async def analyze(request: Request, username: str = Form(...)):
    report = analyze_player(username)
    return templates.TemplateResponse(request, "report.html", {"report": report}) 

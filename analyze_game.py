import requests
import chess
import chess.pgn
import chess.engine
import io

# Pull one game from Lichess
username = "DrNykterstein"
url = f"https://lichess.org/api/games/user/{username}"
headers = {"Accept": "application/x-chess-pgn"}
params = {"max": 1, "perfType": "blitz"}

response = requests.get(url, headers=headers, params=params)
pgn_io = io.StringIO(response.text)
game = chess.pgn.read_game(pgn_io)

print(f"Analyzing: {game.headers.get('White')} vs {game.headers.get('Black')}")
print(f"Result: {game.headers.get('Result')}")
print(f"Opening: {game.headers.get('Opening', 'Unknown')}")
print("-" * 50)

# Start up Stockfish
engine = chess.engine.SimpleEngine.popen_uci("stockfish")

# Walk through every move and evaluate the position
board = game.board()
move_number = 0
previous_eval = 0

for move in game.mainline_moves():
    move_number += 1
    move_san = board.san(move)  # Get move in standard notation (e.g. "Nf3")
    board.push(move)
    
    # Ask Stockfish to evaluate the position (0.3 sec per move, fast for testing)
    info = engine.analyse(board, chess.engine.Limit(time=0.3))
    score = info["score"].white().score(mate_score=10000)
    
    if score is None:
        continue
    
    # Calculate how much the evaluation changed
    eval_change = score - previous_eval
    
    # Flag big swings (in centipawns: 100 = 1 pawn)
    # Big mistakes lose 100+ centipawns from your perspective
    flag = ""
    if board.turn == chess.BLACK:  # White just moved
        if eval_change < -200:
            flag = "  ❌ MISTAKE"
        elif eval_change < -100:
            flag = "  ⚠️  inaccuracy"
    else:  # Black just moved
        if eval_change > 200:
            flag = "  ❌ MISTAKE"
        elif eval_change > 100:
            flag = "  ⚠️  inaccuracy"
    
    print(f"Move {move_number}: {move_san:8s}  Eval: {score/100:+.2f}{flag}")
    previous_eval = score

engine.quit()
print("-" * 50)
print("Analysis complete.")

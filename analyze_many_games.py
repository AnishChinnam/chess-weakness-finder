import requests
import chess
import chess.pgn
import chess.engine
import io
from collections import Counter

# CONFIG — change these to analyze a different player
USERNAME = "DrNykterstein"
NUM_GAMES = 10  # Start with 10 to test. Bump to 50-100 once it works.
TIME_PER_MOVE = 0.1  # seconds Stockfish thinks per position

# Pull games from Lichess
print(f"Pulling {NUM_GAMES} games for {USERNAME}...")
url = f"https://lichess.org/api/games/user/{USERNAME}"
headers = {"Accept": "application/x-chess-pgn"}
params = {"max": NUM_GAMES, "perfType": "blitz"}

response = requests.get(url, headers=headers, params=params)
pgn_io = io.StringIO(response.text)

# Start Stockfish
engine = chess.engine.SimpleEngine.popen_uci("stockfish")

# Data we'll collect across all games
total_mistakes = 0
total_inaccuracies = 0
mistakes_by_phase = Counter()  # opening / middlegame / endgame
mistakes_by_opening = Counter()
losing_openings = Counter()
games_analyzed = 0

def get_phase(move_number):
    """Rough chess phase based on move number."""
    if move_number <= 12:
        return "opening"
    elif move_number <= 30:
        return "middlegame"
    else:
        return "endgame"

# Loop through every game
while True:
    game = chess.pgn.read_game(pgn_io)
    if game is None:
        break
    
    games_analyzed += 1
    white = game.headers.get("White", "?")
    black = game.headers.get("Black", "?")
    result = game.headers.get("Result", "?")
    opening = game.headers.get("Opening", "Unknown")
    
    # Figure out which side the user played
    user_is_white = white.lower() == USERNAME.lower()
    
    # Track if user lost this game (for opening analysis)
    user_lost = False
    if user_is_white and result == "0-1":
        user_lost = True
    elif not user_is_white and result == "1-0":
        user_lost = True
    
    if user_lost:
        losing_openings[opening] += 1
    
    print(f"\nGame {games_analyzed}/{NUM_GAMES}: {white} vs {black} ({result})")
    print(f"  Opening: {opening}")
    
    board = game.board()
    move_number = 0
    previous_eval = 0
    game_mistakes = 0
    
    for move in game.mainline_moves():
        move_number += 1
        board.push(move)
        
   import requests
import chess
import chess.pgn
import chess.engine
import io
from collections import Counter

# CONFIG — change these to analyze a different player
USERNAME = "DrNykterstein"
NUM_GAMES = 10  # Start with 10 to test. Bump to 50-100 once it works.
TIME_PER_MOVE = 0.1  # seconds Stockfish thinks per position

# Pull games from Lichess
print(f"Pulling {NUM_GAMES} games for {USERNAME}...")
url = f"https://lichess.org/api/games/user/{USERNAME}"
headers = {"Accept": "application/x-chess-pgn"}
params = {"max": NUM_GAMES, "perfType": "blitz"}

response = requests.get(url, headers=headers, params=params)
pgn_io = io.StringIO(response.text)

# Start Stockfish
engine = chess.engine.SimpleEngine.popen_uci("stockfish")

# Data we'll collect across all games
total_mistakes = 0
total_inaccuracies = 0
mistakes_by_phase = Counter()  # opening / middlegame / endgame
mistakes_by_opening = Counter()
losing_openings = Counter()
games_analyzed = 0

def get_phase(move_number):
    """Rough chess phase based on move number."""
    if move_number <= 12:
        return "opening"
    elif move_number <= 30:
        return "middlegame"
    else:
        return "endgame"

# Loop through every game
while True:
    game = chess.pgn.read_game(pgn_io)
    if game is None:
        break
    
    games_analyzed += 1
    white = game.headers.get("White", "?")
    black = game.headers.get("Black", "?")
    result = game.headers.get("Result", "?")
    opening = game.headers.get("Opening", "Unknown")
    
    # Figure out which side the user played
    user_is_white = white.lower() == USERNAME.lower()
    
    # Track if user lost this game (for opening analysis)
    user_lost = False
    if user_is_white and result == "0-1":
        user_lost = True
    elif not user_is_white and result == "1-0":
        user_lost = True
    
    if user_lost:
        losing_openings[opening] += 1
    
    print(f"\nGame {games_analyzed}/{NUM_GAMES}: {white} vs {black} ({result})")
    print(f"  Opening: {opening}")
    
    board = game.board()
    move_number = 0
    previous_eval = 0
    game_mistakes = 0
    
    for move in game.mainline_moves():
        move_number += 1
        board.push(move)
        
        info = engine.analyse(board, chess.engine.Limit(time=TIME_PER_MOVE))
        score = info["score"].white().score(mate_score=10000)
        
        if score is None:
            continue
        
        eval_change = score - previous_eval
        
        # Determine whose mistake it was
        white_just_moved = board.turn == chess.BLACK
        
        is_user_mistake = False
        is_user_inaccuracy = False
        
        if white_just_moved and user_is_white:
            if eval_change < -200:
                is_user_mistake = True
            elif eval_change < -100:
                is_user_inaccuracy = True
        elif not white_just_moved and not user_is_white:
            if eval_change > 200:
                is_user_mistake = True
            elif eval_change > 100:
                is_user_inaccuracy = True
        
        if is_user_mistake:
            total_mistakes += 1
            game_mistakes += 1
            mistakes_by_phase[get_phase(move_number)] += 1
            mistakes_by_opening[opening] += 1
        elif is_user_inaccuracy:
            total_inaccuracies += 1
        
        previous_eval = score
    
    print(f"  Mistakes by {USERNAME}: {game_mistakes}")

engine.quit()

# Print the final report
print("\n" + "=" * 60)
print(f"WEAKNESS REPORT FOR {USERNAME}")
print("=" * 60)
print(f"Games analyzed: {games_analyzed}")
print(f"Total mistakes: {total_mistakes}")
print(f"Total inaccuracies: {total_inaccuracies}")
print(f"Avg mistakes per game: {total_mistakes/games_analyzed:.1f}")

print("\nMistakes by game phase:")
for phase, count in mistakes_by_phase.most_common():
    print(f"  {phase}: {count}")

print("\nTop 5 openings where mistakes happen most:")
for opening, count in mistakes_by_opening.most_common(5):
    print(f"  {opening}: {count} mistakes")

print("\nTop 5 openings where you lost:")
for opening, count in losing_openings.most_common(5):
    print(f"  {opening}: {count} losses")

import requests
import chess.pgn
import io

# Pull games from Lichess
username = "DrNykterstein"
url = f"https://lichess.org/api/games/user/{username}"
headers = {"Accept": "application/x-chess-pgn"}
params = {"max": 5, "perfType": "blitz"}

response = requests.get(url, headers=headers, params=params)
pgn_text = response.text

# Parse the games
pgn_io = io.StringIO(pgn_text)

game_count = 0
while True:
    game = chess.pgn.read_game(pgn_io)
    if game is None:
        break
    
    game_count += 1
    white = game.headers.get("White", "?")
    black = game.headers.get("Black", "?")
    result = game.headers.get("Result", "?")
    opening = game.headers.get("Opening", "Unknown")
    
    # Count the moves
    move_count = sum(1 for _ in game.mainline_moves())
    
    print(f"Game {game_count}: {white} vs {black}")
    print(f"  Result: {result}")
    print(f"  Opening: {opening}")
    print(f"  Moves: {move_count}")
    print()

print(f"Total games parsed: {game_count}")


import requests

username = "DrNykterstein"
url = f"https://lichess.org/api/games/user/{username}"
headers = {"Accept": "application/x-chess-pgn"}
params = {"max": 2, "perfType": "blitz"}

response = requests.get(url, headers=headers, params=params)

print("Status code:", response.status_code)
print("Content type:", response.headers.get("Content-Type"))
print("Length:", len(response.text))
print("-" * 50)
print("First 1500 characters of response:")
print("-" * 50)
print(response.text[:1500])

import requests

username = "DrNykterstein"
url = f"https://lichess.org/api/games/user/{username}"
headers = {"Accept": "application/x-ndjson"}
params = {"max": 5, "perfType": "blitz"}

response = requests.get(url, headers=headers, params=params)
print(response.text[:2000])
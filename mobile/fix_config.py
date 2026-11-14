import json

with open("app.json", "r") as f:
    data = json.load(f)

data.pop("extra", None)
data["expo"]["extra"]["apiBaseUrl"] = "http" + "://" + "localhost:8000"

with open("app.json", "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")

print("URL length:", len(data["expo"]["extra"]["apiBaseUrl"]))
print("URL characters:", [ord(c) for c in data["expo"]["extra"]["apiBaseUrl"]])

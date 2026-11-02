"""升级测试用：给安装目录做结构性快照（目录/文件数/大小 + 关键文件哈希）。"""
import hashlib
import io
import json
import os
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = sys.argv[1]
OUT = sys.argv[2]

def sha1(p):
    h = hashlib.sha1()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

snap = {"root": ROOT, "dirs": {}, "key_files": {}, "projects": [], "accounts": 0}

data = os.path.join(ROOT, "data")
if os.path.isdir(data):
    for name in sorted(os.listdir(data)):
        p = os.path.join(data, name)
        if not os.path.isdir(p):
            continue
        cnt = 0
        size = 0
        for r, _d, fs in os.walk(p):
            for f in fs:
                try:
                    st = os.stat(os.path.join(r, f))
                    cnt += 1
                    size += st.st_size
                except OSError:
                    pass
        snap["dirs"][name] = {"files": cnt, "mb": round(size / 1048576, 1)}

# 关键文件
candidates = [
    "data/config.json",
    "data/games",
    "RAINBOW MC.exe",
    "Uninstall RAINBOW MC.exe",
]
cfg = os.path.join(ROOT, "data", "config.json")
if os.path.isfile(cfg):
    snap["key_files"]["config.json"] = sha1(cfg)
    try:
        j = json.load(open(cfg, encoding="utf-8"))
        snap["accounts"] = len(j.get("accounts", []))
        for p in j.get("projects", []):
            snap["projects"].append({"id": p.get("id"), "name": p.get("name"), "versionId": p.get("versionId")})
    except Exception as e:
        snap["config_error"] = str(e)

# 每个实例的存档关键文件
games = os.path.join(ROOT, "data", "games")
if os.path.isdir(games):
    for d in sorted(os.listdir(games)):
        lvl = os.path.join(games, d, "saves")
        if not os.path.isdir(lvl):
            continue
        for save in sorted(os.listdir(lvl))[:3]:
            ld = os.path.join(lvl, save, "level.dat")
            if os.path.isfile(ld):
                snap["key_files"][f"saves/{d}/{save}/level.dat"] = sha1(ld)

# 程序本体版本
exe = os.path.join(ROOT, "RAINBOW MC.exe")
if os.path.isfile(exe):
    snap["exe_sha1"] = sha1(exe)

json.dump(snap, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"快照已写: {OUT}")
print("  data 子目录:", {k: v["files"] for k, v in snap["dirs"].items()})
print("  项目:", [p["name"] for p in snap["projects"]])
print("  账号数:", snap["accounts"], "| 关键文件哈希数:", len(snap["key_files"]))

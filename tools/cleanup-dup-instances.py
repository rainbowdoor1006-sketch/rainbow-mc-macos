"""清理重复测试实例：只保留 香草纪元 + 最新离线包实例，其余移到 F 盘。"""
import io
import json
import os
import shutil
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

CFG = r"D:\APP\RAINBOWMC\data\config.json"
GAMES = r"D:\APP\RAINBOWMC\data\games"
MOVE_TO = r"F:\RAINBOWMC-已移出实例_20261031"
KEEP = {
    "5ee191c0-0832-430e-bd0a-c650b57c9876",  # 香草纪元
    "3f1a4af6-7fc8-4a7a-8253-6d0c799584c2",  # 最新离线包实例（已验证 ok:true）
}

shutil.copy2(CFG, CFG + ".bak-去重前")
j = json.load(open(CFG, encoding="utf-8"))

keep_projects = [p for p in j["projects"] if p["id"] in KEEP]
drop_projects = [p for p in j["projects"] if p["id"] not in KEEP]

os.makedirs(MOVE_TO, exist_ok=True)
moved = []
for p in drop_projects:
    d = os.path.join(GAMES, p["dir"])
    if os.path.isdir(d):
        target = os.path.join(MOVE_TO, p["dir"])
        if os.path.exists(target):
            shutil.rmtree(target, ignore_errors=True)
        try:
            shutil.move(d, target)
            moved.append((p["name"], p["dir"]))
        except Exception as e:
            print("移动失败", p["name"], e)
    else:
        print("目录不存在（仅清配置）:", p["name"])

j["projects"] = keep_projects
if j.get("activeProjectId") not in KEEP:
    j["activeProjectId"] = "5ee191c0-0832-430e-bd0a-c650b57c9876"
json.dump(j, open(CFG, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=2)

print("保留项目:", [p["name"] for p in keep_projects])
print("移走实例数:", len(moved))
for n, d in moved:
    print("  -", n, d)

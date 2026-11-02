"""把某个实例打包成「完整离线整合包」（mrpack 兼容，files 为空 → 不联网下载）。"""
import io
import json
import os
import sys
import zipfile

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

INST = sys.argv[1]
OUT = sys.argv[2]
NAME = sys.argv[3]
MCVER = sys.argv[4]
FORGE = sys.argv[5]

INST = os.path.abspath(INST)

# 只打包这些（与启动器导入白名单一致，避免把日志/崩溃报告/缓存塞进去）
INCLUDE_DIRS = [
    "mods",
    "config",
    "defaultconfigs",
    "resourcepacks",
    "shaderpacks",
    "kubejs",
    "scripts",
    "datapacks",
    "CustomSkinLoader",
    "PCL",
    "patchouli_books",
    "tlm_custom_pack",
]
INCLUDE_FILES = ["options.txt", "servers.dat", "optionsof.txt", "shaderpacks.txt", "icon.png"]
# 明确排除：日志、崩溃报告、缓存、备份、旧数据
EXCLUDE = {".mixin.out", "logs", "crash-reports", "simplebackups", "mods.disabled", "XBX"}

index = {
    "formatVersion": 1,
    "game": "minecraft",
    "versionId": "offline-1",
    "name": NAME,
    "summary": "完整离线包（所有模组/光影/配置已内置，导入后无需联网下载）",
    "files": [],
    "dependencies": {"minecraft": MCVER, "forge": FORGE},
}

count = 0
total_bytes = 0
skipped = []

os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
with zipfile.ZipFile(OUT, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as z:
    z.writestr("modrinth.index.json", json.dumps(index, ensure_ascii=False, indent=2))

    def add(rel_path: str, full: str) -> None:
        global count, total_bytes
        try:
            data = open(full, "rb").read()
        except Exception as e:
            skipped.append(f"{rel_path} ({e})")
            return
        z.writestr("overrides/" + rel_path.replace(os.sep, "/"), data)
        count += 1
        total_bytes += len(data)

    for d in INCLUDE_DIRS:
        base = os.path.join(INST, d)
        if not os.path.isdir(base):
            continue
        for root, dirs, files in os.walk(base):
            dirs[:] = [x for x in dirs if x not in EXCLUDE]
            for f in files:
                if f.endswith((".log", ".part")) or ".seg" in f:
                    continue
                full = os.path.join(root, f)
                rel = os.path.relpath(full, INST)
                add(rel, full)

    for f in INCLUDE_FILES:
        full = os.path.join(INST, f)
        if os.path.isfile(full):
            add(f, full)

print(f"写入文件数: {count}")
print(f"原始大小: {round(total_bytes/1048576,1)} MB")
print(f"输出: {OUT} ({round(os.path.getsize(OUT)/1048576,1)} MB)")
if skipped:
    print("跳过:", len(skipped))
    for s in skipped[:5]:
        print("  ", s)

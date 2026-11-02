"""整合包安装审计：核对清单 vs 落盘，并按 zip 内部结构判断放置是否正确。"""
import io
import json
import os
import sys
import zipfile

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

INST = sys.argv[1]
MRPACK = sys.argv[2] if len(sys.argv) > 2 else None

INST = os.path.abspath(INST)
print("实例:", INST)

# ---------- 1) 目录扫描 ----------
def listdir(d):
    p = os.path.join(INST, d)
    if not os.path.isdir(p):
        return []
    return [f for f in os.listdir(p) if os.path.isfile(os.path.join(p, f))]

mods = listdir("mods")
shaders = listdir("shaderpacks")
resources = listdir("resourcepacks")
print(f"文件数：mods={len(mods)} shaderpacks={len(shaders)} resourcepacks={len(resources)}")

# ---------- 2) 按 zip 内部结构分类 ----------
def classify_zip(path):
    try:
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
    except Exception as e:
        return f"无法读取({type(e).__name__})", []
    has_shaders = any(n.startswith("shaders/") for n in names)
    has_packmeta = any(n == "pack.mcmeta" for n in names)
    has_assets = any(n.startswith("assets/minecraft/") for n in names)
    has_mods_toml = any(n == "META-INF/mods.toml" for n in names)
    has_fabric = any(n == "fabric.mod.json" for n in names)
    if has_shaders:
        kind = "光影"
    elif has_packmeta and has_assets:
        kind = "资源包"
    elif has_mods_toml or has_fabric:
        kind = "模组"
    elif has_packmeta:
        kind = "资源包(可能)"
    else:
        kind = "未知"
    return kind, names[:5]

problems = []
for f in shaders:
    p = os.path.join(INST, "shaderpacks", f)
    low = f.lower()
    if low.endswith(".jar") or low.endswith(".jar.disabled"):
        problems.append(("jar 放在 shaderpacks", f))
        continue
    if low.endswith(".zip"):
        kind, _ = classify_zip(p)
        if kind not in ("光影",):
            problems.append((f"shaderpacks 里的 zip 判定为「{kind}」", f))

for f in resources:
    p = os.path.join(INST, "resourcepacks", f)
    low = f.lower()
    if low.endswith(".jar"):
        problems.append(("jar 放在 resourcepacks", f))
        continue
    if low.endswith(".zip"):
        kind, _ = classify_zip(p)
        if kind == "光影":
            problems.append(("光影被放进了 resourcepacks", f))

for f in mods:
    low = f.lower()
    if low.endswith(".zip"):
        problems.append(("zip 放在 mods", f))
    elif not (low.endswith(".jar") or low.endswith(".jar.disabled")):
        problems.append(("非 jar 文件放在 mods", f))

print("\n=== 放置检查 ===")
if not problems:
    print("未发现放置问题 ✅")
else:
    for reason, f in problems:
        print(f"❌ {reason}：{f}")

# ---------- 3) 与 mrpack 清单对账 ----------
if MRPACK and os.path.exists(MRPACK):
    with zipfile.ZipFile(MRPACK) as z:
        idx = json.loads(z.read("modrinth.index.json").decode("utf-8"))
        listed = [f["path"] for f in idx.get("files", [])]
        sizes = {f["path"]: f.get("fileSize", 0) for f in idx.get("files", [])}
        overrides = [n for n in z.namelist() if n.startswith("overrides/") and not n.endswith("/")]
    print("\n=== 与 pack 清单对账 ===")
    print(f"清单声明下载文件: {len(listed)}   overrides 文件: {len(overrides)}")

    missing, mismatch = [], []
    for rel in listed:
        local = os.path.join(INST, rel)
        if not os.path.exists(local):
            missing.append(rel)
        else:
            exp = sizes.get(rel, 0)
            if exp and os.path.getsize(local) != exp:
                mismatch.append((rel, exp, os.path.getsize(local)))
    ov_missing = []
    for n in overrides:
        rel = n[len("overrides/"):]
        if not os.path.exists(os.path.join(INST, rel)):
            ov_missing.append(rel)

    print(f"缺失(应下载): {len(missing)}")
    for m in missing[:10]:
        print("  ❌", m)
    print(f"大小不符: {len(mismatch)}")
    for m in mismatch[:10]:
        print(f"  ⚠ {m[0]} 期望 {m[1]} 实际 {m[2]}")
    print(f"缺失(overrides): {len(ov_missing)}")
    for m in ov_missing[:10]:
        print("  ❌", m)
    print(
        "\n结论:",
        "完整且放置正确 ✅" if not (problems or missing or mismatch or ov_missing) else "存在问题，见上 ❌",
    )

# ---------- 4) 光影配置一致性 ----------
cfgdir = os.path.join(INST, "config")
for name in ("oculus.properties", "iris.properties"):
    p = os.path.join(cfgdir, name)
    if os.path.exists(p):
        for line in open(p, encoding="utf-8", errors="replace"):
            if line.lower().startswith("shaderpack="):
                val = line.split("=", 1)[1].strip()
                print(f"\n{name} 指定光影: {val or '(空)'}")
                if val:
                    ok = os.path.exists(os.path.join(INST, "shaderpacks", val))
                    print("  该文件是否存在:", "✅ 存在" if ok else "❌ 不存在")

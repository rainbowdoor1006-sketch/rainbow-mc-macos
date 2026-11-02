"""本地更新服务：提供签名清单 + 安装包，用于测试「自动更新→退出→安装→自动拉起」。"""
import http.server
import io
import json
import os
import socketserver
import subprocess
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = r"D:\DeepSeek work\projects\RAINBOW-MC-启动器"
SETUP = os.path.join(ROOT, r"app\release\RAINBOWMC-0.2.86-setup.exe")
PORT = 18300
URL = f"http://127.0.0.1:{PORT}/setup.exe"

# 用项目里的签名工具生成清单
manifest = subprocess.run(
    [
        "node",
        os.path.join(ROOT, "tools", "sign-update.mjs"),
        SETUP,
        "0.2.86",
        URL,
        "自动更新流程测试",
    ],
    cwd=ROOT,
    capture_output=True,
    text=True,
    encoding="utf-8",
)
if manifest.returncode != 0:
    print("签名失败:", manifest.stderr[:400])
    raise SystemExit(1)
mf = json.loads(manifest.stdout)
# 服务器返回格式：{ ok, latest }
payload = json.dumps({"ok": True, "latest": mf}, ensure_ascii=False).encode("utf-8")
setup_bytes = open(SETUP, "rb").read()
print("清单:", mf["version"], mf["sha256"][:12], f'{mf["size"]/1048576:.1f} MB')


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_a):
        pass

    def do_GET(self):
        if self.path.startswith("/version"):
            body = payload
            ctype = "application/json"
        elif self.path.startswith("/setup.exe"):
            body = setup_bytes
            ctype = "application/octet-stream"
        else:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class Srv(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


with Srv(("127.0.0.1", PORT), Handler) as httpd:
    print(f"serving on http://127.0.0.1:{PORT}")
    httpd.serve_forever()

"""GitHub device flow 登录（自己实现，绕开 gh 的代理问题）

用法： python lab/gh_login.py
输出： 只打印 user_code 和状态，access token 写到 lab/gh-token.txt，不打印。
"""
import json
import os
import sys
import time
import urllib.request
import urllib.parse

CLIENT_ID = "178c6fc778ccc68e1d6a"  # GitHub CLI 的公开 client_id
HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE = os.path.join(HERE, "gh-token.txt")

# 直连，不走环境变量里的代理
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def post(url, data, headers=None):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "word-memo-deployer")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with opener.open(req, timeout=30) as r:
        return json.loads(r.read().decode())


def main():
    if os.path.exists(TOKEN_FILE):
        os.remove(TOKEN_FILE)

    d = post("https://github.com/login/device/code",
             {"client_id": CLIENT_ID, "scope": "repo"})
    if "device_code" not in d:
        print("ERR start:", d, flush=True)
        return 1

    print("USER_CODE=" + d["user_code"], flush=True)
    print("URL=" + d["verification_uri"], flush=True)
    print("EXPIRES_IN=" + str(d.get("expires_in", 900)), flush=True)

    interval = max(5, int(d.get("interval", 5)))
    deadline = time.time() + d.get("expires_in", 900)
    device_code = d["device_code"]

    while time.time() < deadline:
        time.sleep(interval)
        try:
            r = post("https://github.com/login/oauth/access_token", {
                "client_id": CLIENT_ID,
                "device_code": device_code,
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            })
        except Exception as e:
            print("retry (network):", e, flush=True)
            continue

        err = r.get("error")
        if not err:
            token = r.get("access_token")
            if token:
                with open(TOKEN_FILE, "w", encoding="utf-8") as f:
                    f.write(token)
                print("OK got token, written to disk", flush=True)
                return 0
            print("ERR weird:", r, flush=True)
            return 1
        if err == "authorization_pending":
            continue
        if err == "slow_down":
            interval += 5
            print("slow_down, interval ->", interval, flush=True)
            continue
        if err == "expired_token":
            print("ERR code expired", flush=True)
            return 1
        if err == "access_denied":
            print("ERR user denied", flush=True)
            return 1
        print("ERR:", r, flush=True)
        return 1

    print("ERR timed out waiting", flush=True)
    return 1


if __name__ == "__main__":
    sys.exit(main())

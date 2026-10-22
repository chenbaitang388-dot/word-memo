"""用已存的 token 直接调 GitHub API：建仓库 → 推送 → 开 Pages → 等构建 → 验证。"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TOKEN = open(os.path.join(HERE, "gh-token.txt"), encoding="utf-8").read().strip()
REPO = "word-memo"
OWNER = None
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def api(method, path, payload=None, base="https://api.github.com"):
    url = base + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "word-memo-deployer")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with opener.open(req, timeout=60) as r:
            body = r.read().decode()
            return r.status, (json.loads(body) if body.strip() else {}), dict(r.headers)
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = body[:300]
        return e.code, parsed, dict(e.headers)


def run(cmd, cwd=ROOT, env=None):
    e = os.environ.copy()
    e.pop("HTTP_PROXY", None)
    e.pop("HTTPS_PROXY", None)
    e.pop("ALL_PROXY", None)
    if env:
        e.update(env)
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=e, shell=False)
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def main():
    global OWNER
    st, me, _ = api("GET", "/user")
    if st != 200:
        print("AUTH FAIL", st, me)
        return 1
    OWNER = me["login"]
    print(f"user: {OWNER}")

    st, repo, _ = api("GET", f"/repos/{OWNER}/{REPO}")
    if st == 404:
        st2, repo, _ = api("POST", "/user/repos", {
            "name": REPO,
            "description": "背单词 PWA（离线可用、SM-2 间隔重复）",
            "private": False,
            "has_issues": True,
            "has_wiki": False,
            "auto_init": False,
        })
        if st2 not in (200, 201):
            print("CREATE FAIL", st2, repo)
            return 1
        print("repo created:", repo["html_url"])
    elif st == 200:
        print("repo exists:", repo["html_url"])
    else:
        print("REPO CHECK FAIL", st, repo)
        return 1

    print("default branch:", repo.get("default_branch"))

    # 推送
    rc, out = run(["git", "branch", "-M", "main"])
    print("branch:", rc, out.strip()[:200])

    remote = f"https://github.com/{OWNER}/{REPO}.git"
    helper = '!f() { echo username=x-access-token; echo password=$GIT_PUSH_TOKEN; }; f'
    rc, out = run(
        ["git", "-c", f"credential.helper={helper}", "push", remote, "HEAD:refs/heads/main"],
        env={"GIT_PUSH_TOKEN": TOKEN, "GIT_TERMINAL_PROMPT": "0"},
    )
    print("push rc:", rc)
    print(out.strip()[-800:])
    if rc != 0:
        print("PUSH FAILED")
        return 1

    time.sleep(2)

    # 开 Pages
    st, pg, _ = api("GET", f"/repos/{OWNER}/{REPO}/pages")
    if st == 404:
        st2, pg, _ = api("POST", f"/repos/{OWNER}/{REPO}/pages",
                         {"source": {"branch": "main", "path": "/"}})
        print("pages create:", st2, json.dumps(pg)[:300] if isinstance(pg, dict) else pg)
    else:
        st2, pg, _ = api("PUT", f"/repos/{OWNER}/{REPO}/pages",
                         {"source": {"branch": "main", "path": "/"}})
        print("pages update:", st2, json.dumps(pg)[:300] if isinstance(pg, dict) else pg)

    # 等构建
    url = None
    for i in range(40):
        st, pg, _ = api("GET", f"/repos/{OWNER}/{REPO}/pages")
        if st == 200:
            url = pg.get("html_url")
            status = pg.get("status")
            print(f"  [{i}] status={status} url={url}")
            if status == "built":
                break
        else:
            print("  pages poll", st, str(pg)[:120])
        time.sleep(5)

    final = f"https://{OWNER}.github.io/{REPO}/"
    print("FINAL:" + final)

    # 验证真的能打开
    for i in range(20):
        try:
            with opener.open(urllib.request.Request(final, headers={"User-Agent": "probe"}), timeout=20) as r:
                html = r.read().decode("utf-8", "replace")
            print(f"  probe {i}: HTTP {r.status}, {len(html)} bytes")
            if "背单词" in html or "<title>" in html:
                print("PROBE_OK")
                break
        except Exception as e:
            print(f"  probe {i}: {type(e).__name__} {str(e)[:100]}")
        time.sleep(5)

    return 0


if __name__ == "__main__":
    sys.exit(main())

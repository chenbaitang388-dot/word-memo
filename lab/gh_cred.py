"""读取 Windows 凭据管理器里 git:https://github.com 的凭据，验证身份。
只打印身份/类型信息，不打印 token 本身。token 写入 lab/gh-token.txt。
"""
import ctypes
import ctypes.wintypes as wt
import json
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE = os.path.join(HERE, "gh-token.txt")
TARGETS = ["git:https://github.com", "LegacyGeneric:target=git:https://github.com"]
CRED_TYPE_GENERIC = 1


class CREDENTIALW(ctypes.Structure):
    _fields_ = [
        ("Flags", wt.DWORD),
        ("Type", wt.DWORD),
        ("TargetName", wt.LPWSTR),
        ("Comment", wt.LPWSTR),
        ("LastWritten", wt.FILETIME),
        ("CredentialBlobSize", wt.DWORD),
        ("CredentialBlob", ctypes.POINTER(ctypes.c_byte)),
        ("Persist", wt.DWORD),
        ("AttributeCount", wt.DWORD),
        ("Attributes", ctypes.c_void_p),
        ("TargetAlias", wt.LPWSTR),
        ("UserName", wt.LPWSTR),
    ]


advapi = ctypes.WinDLL("advapi32", use_last_error=True)
advapi.CredReadW.argtypes = [wt.LPCWSTR, wt.DWORD, wt.DWORD, ctypes.POINTER(ctypes.POINTER(CREDENTIALW))]
advapi.CredReadW.restype = wt.BOOL
advapi.CredFree.argtypes = [ctypes.c_void_p]


def read_cred(target):
    pcred = ctypes.POINTER(CREDENTIALW)()
    if not advapi.CredReadW(target, CRED_TYPE_GENERIC, 0, ctypes.byref(pcred)):
        return None
    try:
        c = pcred.contents
        size = c.CredentialBlobSize
        raw = ctypes.string_at(c.CredentialBlob, size) if size else b""
        return (c.UserName or ""), raw
    finally:
        advapi.CredFree(pcred)


def looks_utf16(raw):
    if len(raw) < 4 or len(raw) % 2:
        return False
    odd = raw[1::2]
    return odd.count(0) / max(1, len(odd)) > 0.8


def decode_blob(raw):
    if looks_utf16(raw):
        return raw.decode("utf-16-le", "replace").rstrip("\x00")
    return raw.replace(b"\x00", b"").decode("utf-8", "replace")


def token_type(t):
    for p in ("ghp_", "github_pat_", "gho_", "ghu_", "ghs_", "ghr_"):
        if t.startswith(p):
            return p
    return "unknown"


def main():
    found = None
    for t in TARGETS:
        r = read_cred(t)
        if r and r[1]:
            found = (t, r[0], r[1])
            break
    if not found:
        print("NO_CREDENTIAL")
        return 1

    target, user, raw = found
    print("TARGET=" + target)
    print("USER=" + user)
    print("BLOB_LEN=" + str(len(raw)))
    print("UTF16=" + str(looks_utf16(raw)))

    text = decode_blob(raw)
    print("TEXT_LEN=" + str(len(text)))
    print("HAS_COLON=" + str(":" in text))

    if ":" in text:
        u, secret = text.split(":", 1)
        print("BLOB_USER=" + u)
    else:
        secret = text
    secret = secret.strip()

    print("SECRET_LEN=" + str(len(secret)))
    print("SECRET_TYPE=" + token_type(secret))
    print("SECRET_HEAD=" + secret[:4])

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def api(path, tok):
        req = urllib.request.Request("https://api.github.com" + path)
        req.add_header("Authorization", "Bearer " + tok)
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("User-Agent", "word-memo-deployer")
        try:
            with opener.open(req, timeout=30) as r:
                return r.status, json.loads(r.read().decode()), r.headers.get("x-oauth-scopes", "")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()[:200], ""
        except Exception as e:
            return -1, str(e)[:200], ""

    status, body, scopes = api("/user", secret)
    print("AUTH_STATUS=" + str(status))
    if status == 200:
        print("LOGIN=" + str(body.get("login")))
        print("NAME=" + str(body.get("name")))
        print("SCOPES=" + scopes)
        with open(TOKEN_FILE, "w", encoding="utf-8") as f:
            f.write(secret)
        print("TOKEN_SAVED=" + TOKEN_FILE)
        return 0

    print("BODY=" + str(body)[:200])

    # 退一步：也许凭据里存的是密码而非 token，试 git 协议的 basic auth
    print("TRY_BASIC_AUTH_CHECK")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

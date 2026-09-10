# E-KAIWA VPS Deployment Runbook

> Purpose: self-contained checklist/runbook for taking E-KAIWA from a fresh Ubuntu VPS to a public HTTPS deployment.
>
> Target architecture: small Ubuntu VPS (~1 GB RAM), one E-KAIWA Python process, Caddy reverse proxy, systemd, no Docker/Gunicorn/multi-worker.
>
> Current public hostname used during this setup: `ekaiwa.duckdns.org`.

---

## 0. Architecture and non-negotiable rules

Production path:

```text
Internet / Phone
      |
   HTTPS :443
   HTTP  :80  -> redirect / ACME validation
      |
    Caddy
      |
      v
127.0.0.1:7860
      |
 E-KAIWA Python
 --mode public
      |
      +---- Gemini HTTP APIs (token / Coach)

Browser -------- direct WebSocket --------> Gemini Live
```

Rules:

- Run exactly **one** E-KAIWA Python process for the current MVP.
- Bind E-KAIWA only to `127.0.0.1:7860`.
- Do **not** expose port `7860` to the Internet.
- Public inbound ports are only `80` and `443` (plus `22` for SSH).
- Use `E_KAIWA_TRUST_PROXY=true` only when E-KAIWA is behind trusted localhost Caddy.
- Use the VPS system Python 3.12 to create a dedicated `.venv` for E-KAIWA.
- Do not reuse unrelated virtualenvs already on the VPS.
- `api.txt` is a secret, stays untracked, and should be mode `600`.
- Current runtime dependency is only `PyYAML>=6,<7`.

Why one worker: current session/rate-limit state is in memory, so multi-worker deployment would break assumptions unless the architecture is changed.

---

## 1. Preflight: inspect the VPS before installing anything

Run this first:

```bash
echo "=== OS / ARCH ==="
cat /etc/os-release | grep -E 'PRETTY_NAME|VERSION_ID'
uname -m

echo
echo "=== CPU / RAM / SWAP / DISK ==="
nproc
free -h
swapon --show
df -h /

echo
echo "=== PYTHON ==="
/usr/bin/python3 --version
readlink -f /usr/bin/python3
/usr/bin/python3 -m venv --help >/dev/null 2>&1 && echo "venv: OK" || echo "venv: MISSING"
/usr/bin/python3 -m pip --version 2>/dev/null || echo "pip: MISSING"

echo
echo "=== BASIC TOOLS ==="
git --version 2>/dev/null || echo "git: MISSING"
curl --version 2>/dev/null | head -1 || echo "curl: MISSING"
systemctl --version | head -1

echo
echo "=== PORTS 80 / 443 / 7860 ==="
sudo ss -lntp | grep -E ':(80|443|7860)\b' || echo "ports: FREE"

echo
echo "=== FIREWALL ==="
sudo ufw status 2>/dev/null || echo "ufw: not installed/inactive"

echo
echo "=== TIME ==="
timedatectl | grep -E 'Time zone|System clock synchronized'

echo
echo "=== DNS / INTERNET ==="
getent hosts github.com
getent hosts generativelanguage.googleapis.com
curl -I -sS --max-time 10 https://github.com | head -1
curl -I -sS --max-time 10 https://generativelanguage.googleapis.com | head -1
```

### Expected baseline

For the VPS used in this deployment, the verified baseline was:

```text
Ubuntu 24.04.4 LTS
x86_64
2 CPU
~954 MiB RAM
4 GiB swap
~45 GiB disk
/usr/bin/python3 -> /usr/bin/python3.12
Python 3.12.3
Git / curl / systemd available
ports 80 / 443 / 7860 initially free
Internet access to GitHub and Google APIs working
Timezone Asia/Tokyo, clock synchronized
```

A `404` from:

```text
https://generativelanguage.googleapis.com/
```

is not itself a connectivity failure. It proves HTTPS reached Google; that root path simply has no useful endpoint.

---

## 2. Important VPS-specific Python warning

On this VPS, the plain command:

```bash
python3
```

was being shadowed by Hermes:

```text
/home/ubuntu/.hermes/hermes-agent/venv/bin/python3
```

That Python was 3.11, while E-KAIWA CI uses Python 3.12.

Therefore always bootstrap E-KAIWA with the system interpreter explicitly:

```bash
/usr/bin/python3.12 -m venv .venv
```

After activating E-KAIWA's own virtualenv, `python` is safe because it resolves to:

```text
/home/ubuntu/e-kaiwa/.venv/bin/python
```

Never install E-KAIWA dependencies into the Hermes environment.

---

## 3. RAM check for a ~1 GB VPS

This VPS already runs Hermes and trading processes. Before deployment, inspect memory:

```bash
free -h
ps aux --sort=-%mem | head -15
```

Observed before reboot:

- Hermes processes used a significant portion of RAM.
- Swap was active and correctly sized at 4 GiB.

After reboot, available RAM improved to roughly 320 MiB and swap usage dropped sharply.

Do not kill unrelated services just to free RAM unless their ownership/purpose is known.

---

## 4. If the VPS says `System restart required`, reboot first

Check:

```bash
if [ -f /var/run/reboot-required ]; then
    cat /var/run/reboot-required
    cat /var/run/reboot-required.pkgs 2>/dev/null || true
else
    echo "reboot not required"
fi
```

During this setup the VPS had pending libc/kernel updates, so it was rebooted before deployment:

```bash
sudo reboot
```

After reconnecting over SSH, verify:

```bash
uname -r
free -h
/usr/bin/python3.12 --version
sudo ss -lntp | grep -E ':(80|443|7860)\b' || echo "ports: FREE"
curl -I -sS --max-time 10 https://github.com | head -1
```

Verified kernel after reboot:

```text
6.17.0-1020-oracle
```

---

## 5. Clone E-KAIWA and create its dedicated virtualenv

From the Ubuntu user's home directory:

```bash
cd ~
git clone https://github.com/kaitobui25/e-kaiwa.git
cd ~/e-kaiwa

/usr/bin/python3.12 -m venv .venv
source .venv/bin/activate

python --version
pip install --upgrade pip
pip install -r src/requirements.txt
```

Verify:

```bash
which python
python --version
pip list
```

Expected interpreter:

```text
/home/ubuntu/e-kaiwa/.venv/bin/python
```

Expected Python:

```text
Python 3.12.x
```

The runtime requirements file currently contains only:

```text
PyYAML>=6.0,<7
```

---

## 6. Deploy Gemini API keys securely

E-KAIWA reads `api.txt` from the repository root:

```text
/home/ubuntu/e-kaiwa/api.txt
```

Create it manually:

```bash
cd ~/e-kaiwa
nano api.txt
```

One Gemini API key per non-empty line.

Then restrict permissions:

```bash
chmod 600 api.txt
ls -l api.txt
```

Expected permissions should look like:

```text
-rw-------
```

Do not commit `api.txt` to GitHub.

---

## 7. First local E-KAIWA test — before Caddy

Start manually:

```bash
cd ~/e-kaiwa
source .venv/bin/activate
python src/app.py --mode public
```

Expected startup includes:

```text
Mode  : public
Local : http://127.0.0.1:7860
Realtime audio path: browser <-> Gemini Live (direct WebSocket)
Coach path         : browser -> this server after each turn
```

From a second SSH terminal test GET:

```bash
curl -s http://127.0.0.1:7860 | head
```

Expected: HTML beginning with the E-KAIWA page.

Do not rely on:

```bash
curl -I http://127.0.0.1:7860
```

The lightweight E-KAIWA HTTP server does not implement `HEAD`, so it can return:

```text
501 Unsupported method ('HEAD')
```

That is not a failed app test. Use `GET`.

---

## 8. Create a free public hostname with DuckDNS

The hostname created for this VPS is:

```text
ekaiwa.duckdns.org
```

Important typo trap:

```text
ekaiwa.duckdns.org     # correct

eikaiwa.duckdns.org    # wrong; extra i
```

DuckDNS must point to the VPS public IPv4, not to the IP of the laptop/phone that opened the DuckDNS website.

Find the VPS public IPv4:

```bash
curl -4 -s https://api.ipify.org
echo
```

Update DuckDNS so `ekaiwa.duckdns.org` points to that IP.

Verify DNS:

```bash
getent ahostsv4 ekaiwa.duckdns.org
```

or:

```bash
python - <<'PY'
import socket
print(socket.gethostbyname("ekaiwa.duckdns.org"))
PY
```

The resolved IPv4 must equal the VPS public IPv4.

### Secret warning

DuckDNS account tokens are secrets. If a token is exposed in a screenshot/chat, recreate/rotate it before using it for any updater.

A DuckDNS auto-update client was **not** configured in this chat. If the Oracle public IP can change, add that later rather than assuming the DNS record will always remain correct.

---

## 9. Oracle Cloud network ingress rules

In Oracle Cloud Console, open the VCN/subnet Security List used by this instance. If the VNIC has an NSG, inspect that too.

Required inbound TCP rules:

```text
22   SSH
80   HTTP / ACME challenge / redirect
443  HTTPS
```

For ports 80 and 443:

```text
Stateless: OFF
Source Type: CIDR
Source CIDR: 0.0.0.0/0
IP Protocol: TCP
Source Port Range: blank
Destination Port Range: 80   (first rule)
Destination Port Range: 443  (second rule)
```

Do **not** open port `7860` in Oracle Cloud.

---

## 10. Install Caddy

Install:

```bash
sudo apt update
sudo apt install -y caddy
```

Verify:

```bash
caddy version
systemctl status caddy --no-pager
```

During this setup Ubuntu installed Caddy `2.6.2` and enabled its systemd service automatically.

---

## 11. Configure Caddy reverse proxy + automatic HTTPS

Write `/etc/caddy/Caddyfile`:

```bash
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
ekaiwa.duckdns.org {
    reverse_proxy 127.0.0.1:7860
}
EOF
```

Validate:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
```

Optional formatting cleanup:

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
```

Restart and inspect:

```bash
sudo systemctl restart caddy
sudo systemctl status caddy --no-pager -l
sudo journalctl -u caddy -n 60 --no-pager
```

Caddy should automatically:

- listen on `80` and `443`;
- redirect HTTP to HTTPS;
- obtain/renew TLS certificates;
- reverse proxy to `127.0.0.1:7860`.

---

## 12. The actual firewall problem found on this VPS

Oracle ingress alone was not enough.

The VPS host firewall had this effective INPUT chain:

```text
1 ACCEPT RELATED,ESTABLISHED
2 ACCEPT ICMP
3 ACCEPT loopback
4 ACCEPT NEW TCP dpt:22
5 REJECT everything else
```

That meant Caddy could listen on ports 80/443, but Internet traffic was rejected before reaching it.

Symptoms in Caddy logs:

```text
challenge failed
Timeout during connect (likely firewall problem)
Error getting validation data
```

Let’s Encrypt could not reach:

```text
http://ekaiwa.duckdns.org/.well-known/acme-challenge/...
```

Confirm current rules with:

```bash
sudo iptables -L INPUT -n -v --line-numbers
sudo nft list ruleset
```

The system was using iptables rules backed by nftables.

### Fix

Insert TCP 80 and 443 ACCEPT rules before the final REJECT:

```bash
sudo iptables -I INPUT 5 -p tcp --dport 80  -m conntrack --ctstate NEW -j ACCEPT
sudo iptables -I INPUT 5 -p tcp --dport 443 -m conntrack --ctstate NEW -j ACCEPT
```

Check order:

```bash
sudo iptables -L INPUT -n -v --line-numbers
```

Expected logical order:

```text
ACCEPT established
ACCEPT ICMP
ACCEPT loopback
ACCEPT SSH 22
ACCEPT HTTPS 443
ACCEPT HTTP 80
REJECT everything else
```

Then force a fresh Caddy attempt:

```bash
sudo systemctl restart caddy
sleep 8
sudo journalctl -u caddy -n 30 --no-pager
```

After this fix, public HTTPS returned `HTTP 200`.

---

## 13. Persist host firewall rules across reboot

The two `iptables -I` commands above change the running rules only. They can disappear after reboot unless persisted.

Install persistence support and save:

```bash
sudo apt install -y iptables-persistent
sudo netfilter-persistent save
```

Verify saved web rules:

```bash
sudo grep -E 'dport (22|80|443)|--dport (22|80|443)' /etc/iptables/rules.v4
```

Verify service:

```bash
sudo systemctl status netfilter-persistent --no-pager
```

**Status note:** persistence commands were recommended in this chat, but their successful output was not shown. Treat this as a required verification item before considering the VPS reboot-safe.

---

## 14. Run E-KAIWA behind Caddy with trusted-proxy mode

For manual production testing:

```bash
cd ~/e-kaiwa
source .venv/bin/activate

E_KAIWA_TRUST_PROXY=true python src/app.py --mode public
```

Or without activating the virtualenv:

```bash
cd ~/e-kaiwa

E_KAIWA_TRUST_PROXY=true \
/home/ubuntu/e-kaiwa/.venv/bin/python \
/home/ubuntu/e-kaiwa/src/app.py --mode public
```

Using absolute interpreter/path is better for systemd because it does not depend on shell activation.

If startup fails with:

```text
OSError: [Errno 98] Address already in use
```

then another E-KAIWA process is already listening on `7860`.

Check:

```bash
sudo ss -lntp | grep ':7860'
ps -ef | grep 'src/app.py --mode public' | grep -v grep
```

Do not start a second copy.

---

## 15. Verify listening sockets

Useful command:

```bash
sudo ss -lntup | grep -E ':(80|443|7860)\b'
```

Healthy state:

```text
Caddy TCP *:80
Caddy TCP *:443
Caddy may also listen UDP *:443 for HTTP/3
E-KAIWA TCP 127.0.0.1:7860
```

The important security invariant is:

```text
7860 -> 127.0.0.1 only
```

---

## 16. Public HTTPS test

Use a GET request with a timeout:

```bash
curl --max-time 15 -sS -o /dev/null \
  -w "HTTP %{http_code}\n" \
  https://ekaiwa.duckdns.org/
```

Expected:

```text
HTTP 200
```

Then test in a real phone browser:

```text
https://ekaiwa.duckdns.org
```

Real-device testing matters because microphone permissions and Gemini Live audio/WebSocket behavior happen in the browser.

---

## 17. Diagnose Caddy certificate failures

If HTTPS hangs or Caddy cannot get a certificate:

```bash
sudo ss -lntup | grep -E ':(80|443|7860)\b'
sudo systemctl status caddy --no-pager -l
sudo journalctl -u caddy -n 60 --no-pager
sudo iptables -L INPUT -n -v --line-numbers
sudo nft list ruleset
```

Interpretation:

### Caddy listens on 80/443, but ACME says timeout

Check both layers:

1. Oracle Cloud Security List / NSG allows inbound TCP 80/443.
2. VPS host firewall allows inbound TCP 80/443 before any REJECT/DROP.

### Local Caddy TLS test fails before certificate exists

A command like:

```bash
curl -vk --max-time 10 \
  --resolve ekaiwa.duckdns.org:443:127.0.0.1 \
  https://ekaiwa.duckdns.org/
```

may fail its TLS handshake while Caddy has no certificate yet. Do not misdiagnose that as an E-KAIWA backend failure.

### ZeroSSL errors

During this setup Caddy fell back to ZeroSSL after Let’s Encrypt validation failed. The ZeroSSL message was secondary. Fix inbound connectivity first; do not chase the fallback error while ports 80/443 are blocked.

---

## 18. Make E-KAIWA start automatically with systemd

Manual terminal execution does **not** survive VPS reboot. Caddy already runs under systemd, but E-KAIWA needs its own service.

First stop any manually running E-KAIWA process (`Ctrl+C` in its terminal), then create:

```bash
sudo tee /etc/systemd/system/ekaiwa.service >/dev/null <<'EOF'
[Unit]
Description=E-KAIWA Live
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/e-kaiwa
Environment=E_KAIWA_TRUST_PROXY=true
ExecStart=/home/ubuntu/e-kaiwa/.venv/bin/python /home/ubuntu/e-kaiwa/src/app.py --mode public
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
```

Load and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ekaiwa
```

Verify:

```bash
sudo systemctl status ekaiwa --no-pager -l
systemctl is-enabled ekaiwa caddy
systemctl is-active ekaiwa caddy
```

Expected:

```text
enabled
enabled
active
active
```

Then verify public HTTPS again:

```bash
curl --max-time 15 -sS -o /dev/null \
  -w "HTTP %{http_code}\n" \
  https://ekaiwa.duckdns.org/
```

**Status note:** the systemd service definition was prepared in this chat, but successful `enable --now` output was not shown. Treat this as a required finalization/verification step.

---

## 19. Final reboot-proof verification

Only after both firewall persistence and E-KAIWA systemd service are verified, perform the real final test:

```bash
sudo reboot
```

Reconnect over SSH and run:

```bash
echo "=== SERVICES ==="
systemctl is-enabled ekaiwa caddy
systemctl is-active ekaiwa caddy

echo
echo "=== PORTS ==="
sudo ss -lntup | grep -E ':(80|443|7860)\b'

echo
echo "=== FIREWALL ==="
sudo iptables -L INPUT -n -v --line-numbers

echo
echo "=== PUBLIC HTTPS ==="
curl --max-time 15 -sS -o /dev/null \
  -w "HTTP %{http_code}\n" \
  https://ekaiwa.duckdns.org/
```

Expected final state:

```text
ekaiwa enabled + active
caddy enabled + active
Caddy listens :80 / :443
E-KAIWA listens 127.0.0.1:7860
host firewall allows 22 / 80 / 443 then rejects other unsolicited inbound traffic
HTTPS returns HTTP 200
```

Then open on a real phone and exercise microphone / conversation / Coach flow.

---

## 20. Day-to-day service commands

### E-KAIWA

```bash
sudo systemctl status ekaiwa --no-pager -l
sudo systemctl restart ekaiwa
sudo journalctl -u ekaiwa -n 100 --no-pager
sudo journalctl -u ekaiwa -f
```

### Caddy

```bash
sudo systemctl status caddy --no-pager -l
sudo systemctl restart caddy
sudo journalctl -u caddy -n 100 --no-pager
sudo journalctl -u caddy -f
sudo caddy validate --config /etc/caddy/Caddyfile
```

### Network

```bash
sudo ss -lntup | grep -E ':(22|80|443|7860)\b'
sudo iptables -L INPUT -n -v --line-numbers
getent ahostsv4 ekaiwa.duckdns.org
curl -4 -s https://api.ipify.org; echo
```

---

## 21. Updating E-KAIWA later

Do not run `git pull` while blindly assuming the service will continue correctly.

Recommended simple update flow:

```bash
cd ~/e-kaiwa

git status
git fetch origin
git pull --ff-only origin main

source .venv/bin/activate
pip install -r src/requirements.txt

python -m unittest discover -s src/tests/python -p "test_*.py"
python -m compileall -q src/e_kaiwa src/app.py

sudo systemctl restart ekaiwa
sudo systemctl status ekaiwa --no-pager -l

curl --max-time 15 -sS -o /dev/null \
  -w "HTTP %{http_code}\n" \
  https://ekaiwa.duckdns.org/
```

If frontend modules changed, also verify the public page on a real browser/phone.

---

## 22. Current verified state at the end of this setup chat

Verified successfully:

```text
Ubuntu 24.04.4 LTS
Python system 3.12.3
E-KAIWA dedicated .venv created
E-KAIWA can start in public mode
E-KAIWA local GET works on 127.0.0.1:7860
DuckDNS hostname: ekaiwa.duckdns.org
DuckDNS points to VPS public IPv4
Oracle inbound 80/443 configured
Caddy installed and active
Caddy reverse proxy configured
Host iptables 80/443 blocker identified and fixed
Public https://ekaiwa.duckdns.org returns HTTP 200
```

Still requiring explicit final verification after this chat:

```text
iptables rules persisted with iptables-persistent/netfilter-persistent
E-KAIWA systemd service enabled and active
full reboot test proving firewall + E-KAIWA + Caddy all recover automatically
real-phone Gemini Live microphone/conversation/Coach smoke test over HTTPS
```

---

## 23. Minimal mental model for future debugging

When the site fails, debug from the inside out:

```text
1. Is E-KAIWA alive?
   curl http://127.0.0.1:7860

2. Is 7860 bound only locally?
   ss -lntp | grep 7860

3. Is Caddy alive and listening 80/443?
   systemctl status caddy
   ss -lntp | grep -E ':(80|443)\b'

4. Does host firewall allow 80/443?
   iptables -L INPUT -n -v --line-numbers

5. Does Oracle Security List / NSG allow 80/443?

6. Does DuckDNS resolve to the current VPS public IPv4?
   getent ahostsv4 ekaiwa.duckdns.org
   curl -4 -s https://api.ipify.org

7. Can Caddy obtain/renew TLS?
   journalctl -u caddy

8. Does public HTTPS return 200?
   curl --max-time 15 -sS -o /dev/null -w 'HTTP %{http_code}\n' https://ekaiwa.duckdns.org/

9. Finally test browser microphone + Gemini Live on a real phone.
```

This order prevents wasting time debugging Gemini/UI when the actual problem is DNS, firewall, TLS, or process startup.

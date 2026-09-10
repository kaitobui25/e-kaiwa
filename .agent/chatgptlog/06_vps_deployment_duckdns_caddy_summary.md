# ChatGPT Log 06 — VPS deployment, DuckDNS, Caddy HTTPS, firewall debugging, systemd handoff

## Scope

This log summarizes the VPS deployment conversation after Plan 06/UI work.

Main themes:
- preflight an existing Ubuntu VPS before installing E-KAIWA
- verify Python/runtime/resources/network
- deploy the repo into an isolated Python 3.12 virtualenv
- provision a free DuckDNS hostname
- run E-KAIWA locally on `127.0.0.1:7860`
- install and configure Caddy as the public HTTPS reverse proxy
- debug failed ACME/TLS issuance through Oracle Cloud and host firewall layers
- make firewall rules persistent
- prepare E-KAIWA to run under systemd after reboot
- write a reusable deployment runbook for future operators/AI agents

This conversation was operational/deployment work only; no E-KAIWA application code was changed.

---

## 1. Starting deployment architecture

The deployment architecture inherited from the previous chat was kept intentionally simple for the ~1 GB Ubuntu VPS:

```text
Internet / Phone
      |
   HTTPS :443
   HTTP  :80
      |
    Caddy
      |
      v
127.0.0.1:7860
      |
 E-KAIWA Python
 --mode public
      |
      +---- Gemini HTTP / token / Coach
      |
Browser -------- direct WebSocket --------> Gemini Live
```

Key rules:
- one E-KAIWA Python process only
- no Docker
- no Kubernetes
- no Gunicorn / multi-worker setup
- Caddy is the only Internet-facing application process
- E-KAIWA stays bound to `127.0.0.1:7860`
- do not expose port `7860` publicly
- use `E_KAIWA_TRUST_PROXY=true` only when running behind the trusted localhost Caddy proxy
- `api.txt` stays local/untracked and should use restrictive permissions
- systemd should own long-running E-KAIWA after deployment

---

## 2. Initial VPS preflight

The VPS was already reachable over SSH and already had Python, but we deliberately checked the environment before installing anything.

Observed VPS state:

```text
OS      : Ubuntu 24.04.4 LTS
Arch    : x86_64
CPU     : 2 vCPU
RAM     : ~954 MiB
Disk    : 45 GB total, ~19 GB free at first check
Swap    : 4 GB
Timezone: Asia/Tokyo
systemd : available
Git     : 2.43.0
curl    : 8.5.0
```

Ports before deployment:

```text
80   free
443  free
7860 free
```

Internet/DNS tests succeeded for:
- `github.com`
- `generativelanguage.googleapis.com`

A `HTTP/2 404` from the root of `generativelanguage.googleapis.com` was treated correctly as proof that HTTPS connectivity to Google worked; the root path itself simply does not provide an application endpoint.

---

## 3. Important Python PATH issue: Hermes shadowed `python3`

The shell-level command:

```bash
python3
```

was not the Ubuntu system Python. It resolved to a Hermes agent virtualenv:

```text
/home/ubuntu/.hermes/hermes-agent/venv/bin/python3
```

and reported Python 3.11.15.

This was important because E-KAIWA CI currently tests on Python 3.12.

The actual system Python was verified explicitly:

```bash
/usr/bin/python3 --version
/usr/bin/python3.12 --version
```

Result:

```text
Python 3.12.3
/usr/bin/python3 -> /usr/bin/python3.12
```

System packages also confirmed:
- `python3.12`
- `python3.12-venv`
- `python3-venv`
- `python3-pip`

Deployment decision:
- never create/install the E-KAIWA environment through the Hermes Python
- always create the app venv explicitly with `/usr/bin/python3.12`

Canonical venv creation command:

```bash
/usr/bin/python3.12 -m venv .venv
```

---

## 4. RAM/process inspection

The VPS is small, so memory was checked before adding another service.

Before reboot, Hermes processes used a large fraction of RAM and swap use was ~443 MiB.

Major processes included:

```text
/home/ubuntu/.hermes/hermes-agent/venv/bin/python... gateway...
/home/ubuntu/my-trading/...
Oracle Cloud agent processes
```

Hermes was intentionally not killed because its operational role on the VPS was not yet known.

After reboot, memory state improved materially:

```text
RAM total     : ~954 MiB
RAM available : ~320 MiB
Swap          : 4 GB total, only ~33 MiB used
```

Conclusion:
- VPS is constrained but usable for the current lightweight E-KAIWA architecture
- keep deployment to one Python process + Caddy
- avoid unnecessary infrastructure or additional workers

---

## 5. Required reboot / kernel update

SSH initially showed:

```text
*** System restart required ***
```

Pending packages included:

```text
libc6
linux-image-6.17.0-1019-oracle
linux-image-6.17.0-1020-oracle
linux-base
```

The VPS was rebooted before deployment work continued.

After reboot:

```text
uname -r
6.17.0-1020-oracle
```

Ports `80`, `443`, and `7860` were still free and Internet access still worked.

---

## 6. E-KAIWA installation on VPS

Repository location used:

```text
/home/ubuntu/e-kaiwa
```

Install flow:

```bash
cd ~
git clone https://github.com/kaitobui25/e-kaiwa.git
cd e-kaiwa
/usr/bin/python3.12 -m venv .venv
source .venv/bin/activate
python --version
pip install --upgrade pip
pip install -r src/requirements.txt
```

Current E-KAIWA runtime dependency remains minimal:

```text
PyYAML>=6.0,<7
```

Expected app Python after activation:

```text
/home/ubuntu/e-kaiwa/.venv/bin/python
Python 3.12.x
```

---

## 7. `api.txt` deployment

`api.txt` belongs at the repository root:

```text
/home/ubuntu/e-kaiwa/api.txt
```

It contains one Gemini API key per non-empty line.

Permissions recommended/used:

```bash
chmod 600 api.txt
```

Important:
- `api.txt` is gitignored
- do not commit it
- do not expose it through Caddy or any public directory

---

## 8. Free public hostname with DuckDNS

A free DuckDNS hostname was created for the VPS.

Final correct hostname:

```text
ekaiwa.duckdns.org
```

A naming mistake happened during testing:

```text
wrong: eikaiwa.duckdns.org
right: ekaiwa.duckdns.org
```

The wrong hostname produced:

```text
socket.gaierror: [Errno -2] Name or service not known
```

This was purely a spelling mismatch.

Another important DNS detail:
- DuckDNS initially captured the IP of the machine/browser used during registration, not the VPS public IP
- VPS public IPv4 was determined with:

```bash
curl -4 -s https://api.ipify.org
```

Actual VPS public IPv4:

```text
217.142.225.255
```

DuckDNS was updated so:

```text
ekaiwa.duckdns.org -> 217.142.225.255
```

Validation commands:

```bash
getent ahostsv4 ekaiwa.duckdns.org

python - <<'PY'
import socket
print(socket.gethostbyname("ekaiwa.duckdns.org"))
PY
```

Security note:
- a DuckDNS token was visible in a screenshot during the chat
- token should be treated as compromised and regenerated before configuring any automated DuckDNS updater

---

## 9. Local E-KAIWA test before Caddy

E-KAIWA was first run locally, before introducing the reverse proxy:

```bash
cd ~/e-kaiwa
source .venv/bin/activate
python src/app.py --mode public
```

The app started successfully on:

```text
http://127.0.0.1:7860
```

Local test:

```bash
curl -s http://127.0.0.1:7860 | head
```

returned the E-KAIWA HTML:

```html
<!doctype html>
<html lang="ja">
...
<title>E-KAIWA</title>
```

`curl -I http://127.0.0.1:7860` returned:

```text
HTTP/1.0 501 Unsupported method ('HEAD')
```

This was not considered an app failure. The lightweight Python server does not implement HEAD, while normal GET requests work correctly.

Deployment testing rule going forward:
- use GET-based checks for E-KAIWA
- do not interpret HEAD 501 as a backend outage

---

## 10. Trusted proxy mode

Once Caddy was introduced, E-KAIWA was launched with:

```bash
E_KAIWA_TRUST_PROXY=true python src/app.py --mode public
```

More robust explicit command that avoids any shell/PATH ambiguity:

```bash
cd /home/ubuntu/e-kaiwa
E_KAIWA_TRUST_PROXY=true \
/home/ubuntu/e-kaiwa/.venv/bin/python \
/home/ubuntu/e-kaiwa/src/app.py --mode public
```

Successful runtime output included:

```text
E-KAIWA LIVE - Gemini Live audio-to-audio + Coach sidecar
Mode  : public
Model : gemini-3.1-flash-live-preview
Config: /home/ubuntu/e-kaiwa/config.yaml
Local : http://127.0.0.1:7860
Realtime audio path: browser <-> Gemini Live (direct WebSocket)
Coach path         : browser -> this server after each turn
```

---

## 11. Caddy installation and configuration

There was one operator mistake where `apt update` was run but the actual install command was skipped, causing:

```text
/etc/caddy/Caddyfile: No such file or directory
caddy: command not found
caddy.service not found
```

Correct install:

```bash
sudo apt install -y caddy
```

Installed version during this chat:

```text
Caddy 2.6.2
```

Caddy systemd service came up enabled and active.

Caddyfile:

```caddy
ekaiwa.duckdns.org {
    reverse_proxy 127.0.0.1:7860
}
```

Location:

```text
/etc/caddy/Caddyfile
```

Validation/restart commands:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl restart caddy
sudo systemctl status caddy --no-pager -l
```

Caddy validation succeeded.

The warning:

```text
Caddyfile input is not formatted
```

was cosmetic, not a functional configuration error.

---

## 12. First HTTPS failure: Oracle/Internet path diagnosis

Initial public HTTPS test hung or failed:

```bash
curl https://ekaiwa.duckdns.org/
```

Caddy ACME logs showed explicit external connection failures from Let's Encrypt:

```text
Timeout during connect (likely firewall problem)
```

for both:
- HTTP-01 on port 80
- TLS-ALPN-01 on port 443

This proved:
- DNS pointed to the expected VPS IP
- Caddy attempted automatic TLS correctly
- certificate issuance failed because inbound Internet traffic could not reach the listener

Oracle Cloud ingress rules were therefore required for at least:

```text
TCP 22   SSH
TCP 80   HTTP / ACME / redirect
TCP 443  HTTPS
```

Do not add public ingress for `7860`.

For Oracle Security List/NSG rules, the source port should be left blank/all ephemeral source ports; destination port is `80` or `443`.

---

## 13. Second HTTPS failure: host iptables firewall

Even after Oracle ingress was opened, Let's Encrypt still failed.

A deeper VPS check showed:

```bash
sudo ss -lntup | grep -E ':(80|443|7860)\b'
```

Result:

```text
Caddy  : *:80
Caddy  : *:443
E-KAIWA: 127.0.0.1:7860
```

So all services were listening correctly.

The real blocker was the host firewall.

`iptables` INPUT chain was effectively:

```text
1 ACCEPT RELATED,ESTABLISHED
2 ACCEPT ICMP
3 ACCEPT loopback
4 ACCEPT new TCP dport 22
5 REJECT everything else
```

Equivalent nftables view also showed the final host-prohibited reject.

This meant Oracle Cloud networking could allow 80/443 but Ubuntu itself would still reject the packets.

Fix applied:

```bash
sudo iptables -I INPUT 5 -p tcp --dport 80  -m conntrack --ctstate NEW -j ACCEPT
sudo iptables -I INPUT 5 -p tcp --dport 443 -m conntrack --ctstate NEW -j ACCEPT
```

These ACCEPT rules were deliberately inserted before the catch-all REJECT.

After restarting Caddy and retrying ACME, public HTTPS succeeded.

Final public test:

```bash
curl --max-time 15 -sS -o /dev/null \
  -w "HTTP %{http_code}\n" \
  https://ekaiwa.duckdns.org/
```

Result:

```text
HTTP 200
```

This is the key verified milestone of the chat.

---

## 14. Firewall persistence

The newly inserted iptables rules are runtime-only unless persisted.

Recommended persistence commands supplied in the chat:

```bash
sudo apt install -y iptables-persistent
sudo netfilter-persistent save
```

Verification:

```bash
sudo grep -E 'dport (22|80|443)|--dport (22|80|443)' /etc/iptables/rules.v4
sudo systemctl status netfilter-persistent --no-pager
```

Status note:
- the commands were provided after HTTPS reached `HTTP 200`
- the conversation does not contain a pasted confirmation that persistence was successfully completed
- future operator should verify `/etc/iptables/rules.v4` and reboot behavior before assuming this is done

---

## 15. Duplicate app process / port 7860 behavior

When E-KAIWA was started a second time while an earlier process was still listening, Python raised:

```text
OSError: [Errno 98] Address already in use
```

This means another E-KAIWA/Python process already owned `127.0.0.1:7860`.

Useful checks:

```bash
sudo ss -lntp | grep ':7860'
ps -ef | grep 'src/app.py --mode public' | grep -v grep
```

Do not launch two instances.

Once the old process was stopped, the explicit venv command successfully started E-KAIWA on `127.0.0.1:7860`.

---

## 16. systemd handoff for E-KAIWA

Running E-KAIWA manually in an SSH terminal does not survive a VPS reboot.

Caddy is already managed by systemd, but E-KAIWA needs its own service.

Service definition supplied:

```ini
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
```

Target file:

```text
/etc/systemd/system/ekaiwa.service
```

Commands supplied:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ekaiwa
```

Checks:

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

Status note:
- the service creation/enable instructions were given at the end of the chat
- there is no pasted confirmation yet that `ekaiwa.service` was actually created/enabled and survived reboot
- this remains the most important deployment item to verify next

---

## 17. Final intended reboot-safe state

Desired steady state:

```text
VPS boots
  |
  +-- netfilter-persistent restores host firewall rules
  |
  +-- caddy.service starts
  |     +-- listens :80 / :443
  |     +-- handles TLS certificate and redirect
  |     +-- proxies to 127.0.0.1:7860
  |
  +-- ekaiwa.service starts
        +-- User=ubuntu
        +-- WorkingDirectory=/home/ubuntu/e-kaiwa
        +-- E_KAIWA_TRUST_PROXY=true
        +-- .venv Python 3.12
        +-- src/app.py --mode public
```

Public URL:

```text
https://ekaiwa.duckdns.org
```

Backend must remain private:

```text
127.0.0.1:7860
```

---

## 18. Reusable deployment runbook created

To avoid reconstructing the deployment process in future chats, a dedicated note was created:

```text
.agent/chatgptnote/01_vps_deployment_runbook.md
```

Purpose:
- self-contained preflight/deployment/operations checklist
- future AI/operator should be able to read one file and understand the complete order of work
- includes common mistakes and troubleshooting sequence

Commit that created the runbook during this chat:

```text
7081d7b60f2e5eb6502f1ab26603bf60ebb613eb
```

The runbook should be preferred over reconstructing VPS commands from chat history.

---

## 19. Key lessons from this deployment

### A. Always distinguish shell Python from system Python

`python3` can be shadowed by another application's virtualenv. For this VPS, Hermes changed PATH behavior.

Use explicit interpreter paths during bootstrap and systemd setup.

### B. Debug networking layer-by-layer

Correct order:

```text
E-KAIWA local GET
    -> Caddy listener
    -> host firewall
    -> Oracle Security List / NSG
    -> DNS
    -> ACME/TLS
    -> public HTTPS
```

Do not randomly change Caddy when Let's Encrypt explicitly reports an external connection timeout.

### C. Cloud firewall and host firewall are separate

Opening Oracle Cloud 80/443 was necessary but insufficient because iptables still had a catch-all REJECT.

Both layers must allow the traffic.

### D. Do not expose port 7860

Only Caddy should be Internet-facing. E-KAIWA should remain localhost-only.

### E. GET is the meaningful E-KAIWA health check

The current lightweight server returns 501 for HEAD. Use GET-based `curl` checks.

### F. Avoid multiple app instances

`Address already in use` on 7860 generally means the current app is already running.

### G. Long-running services belong to systemd

Manual SSH sessions are only for testing. Production should use `ekaiwa.service` + `caddy.service`.

---

## 20. Verified state at end of this chat

Verified successfully:

```text
Ubuntu 24.04.4 LTS                    OK
Python system 3.12.3                  OK
E-KAIWA isolated .venv                OK
E-KAIWA local 127.0.0.1:7860          OK
DuckDNS ekaiwa.duckdns.org            OK
DNS -> 217.142.225.255                OK
Caddy installed                       OK
Caddy reverse proxy config            OK
Oracle ingress 80/443                 opened during debugging
Host iptables 80/443                  fixed at runtime
HTTPS certificate / public path       OK
https://ekaiwa.duckdns.org            HTTP 200
```

Still needs explicit confirmation in a future turn/session:

```text
iptables rules saved persistently      VERIFY
netfilter-persistent enabled           VERIFY
ekaiwa.service created                 VERIFY
ekaiwa.service enabled + active        VERIFY
full VPS reboot survival test          VERIFY
real mobile microphone/Gemini session  VERIFY after daemonization
DuckDNS exposed token regenerated      VERIFY
```

---

## 21. Recommended next step

Do not change application code.

Finish deployment hardening only:

1. verify `iptables-persistent` / `netfilter-persistent`
2. create and enable `ekaiwa.service` if not already done
3. verify both `ekaiwa` and `caddy` show `enabled` + `active`
4. reboot VPS once
5. after reboot, verify:

```bash
systemctl is-active ekaiwa caddy
sudo ss -lntp | grep -E ':(80|443|7860)\b'
curl -sS -o /dev/null -w "HTTP %{http_code}\n" https://ekaiwa.duckdns.org/
```

6. confirm `HTTP 200`
7. open `https://ekaiwa.duckdns.org` on a real phone and perform one complete voice conversation turn

Only after that should this VPS deployment be considered fully complete.

# CoWork Runbook: Self-Hosted Jitsi auf Ubuntu

Dieses Runbook beschreibt ein schlankes MVP-Setup für CoWork (Video-Kollaboration) mit eigener Jitsi-Instanz.

## Ziel

- Keine JaaS-Demo-Limits
- Eigene Domain und TLS
- Einfache Anbindung an CuraFlow über `VITE_JITSI_BASE_URL`

## Architektur (MVP)

- 1x Ubuntu-VM (öffentliche IP)
- 1x DNS-Name, z. B. `jitsi.example.com`
- Jitsi Meet (Web + Prosody + Jicofo + JVB) auf einem Host

## Mindestgröße

- Test/kleines Team: 2 vCPU, 4 GB RAM, 40 GB SSD
- Für mehr gleichzeitige Meetings später vertikal skalieren (CPU/Bandbreite zuerst)

## Voraussetzungen

- Ubuntu 22.04/24.04 LTS
- Domain mit DNS-Zugriff
- Ports offen:
  - `80/tcp` (HTTP, Zertifikatserstellung)
  - `443/tcp` (HTTPS)
  - `10000/udp` (Media RTP)
  - optional `22/tcp` (SSH)

## Schritt 1: DNS setzen

- `A`-Record: `jitsi.example.com` -> öffentliche IPv4 der VM
- Optional `AAAA`-Record, falls IPv6 genutzt wird

Prüfen:

```bash
nslookup jitsi.example.com
```

## Schritt 2: Server vorbereiten

```bash
sudo apt update && sudo apt -y upgrade
sudo timedatectl set-timezone Europe/Berlin
sudo apt install -y curl gnupg2 ufw
```

Firewall:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 10000/udp
sudo ufw --force enable
sudo ufw status
```

## Schritt 3: Jitsi Paketquelle einrichten

```bash
curl -fsSL https://download.jitsi.org/jitsi-key.gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/jitsi-keyring.gpg
echo 'deb [signed-by=/usr/share/keyrings/jitsi-keyring.gpg] https://download.jitsi.org stable/' | sudo tee /etc/apt/sources.list.d/jitsi-stable.list
sudo apt update
```

## Schritt 4: Jitsi installieren

```bash
sudo apt install -y jitsi-meet
```

Während der Installation:

- Hostname: `jitsi.example.com`
- Zertifikat: zuerst „self-signed“ wählen (Let's Encrypt folgt im nächsten Schritt)

## Schritt 5: Let's Encrypt aktivieren

```bash
sudo /usr/share/jitsi-meet/scripts/install-letsencrypt-cert.sh
```

Danach HTTPS im Browser prüfen:

- `https://jitsi.example.com`

## Schritt 6: Basis-Härtung (empfohlen)

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

Optional: Fail2ban ergänzen.

## Schritt 7: CuraFlow anbinden

Frontend-Umgebung setzen:

```env
VITE_JITSI_BASE_URL=https://jitsi.example.com
```

Dann Frontend neu bauen/deployen:

```bash
npm run build
```

## Schritt 8: Smoke-Test

1. In CuraFlow als Admin anmelden
2. CoWork oeffnen und einen online Admin einladen
3. Zweiten Browser/Inkognito als eingeladener Admin in CuraFlow anmelden
4. Einladung im Widget annehmen und dem gleichen Raum beitreten
5. Audio, Video und Screen-Sharing testen
6. Netzwerkwechsel (WLAN/LTE) kurz pruefen

## Betrieb & Monitoring

Wichtige Dienste:

```bash
sudo systemctl status prosody
sudo systemctl status jicofo
sudo systemctl status jitsi-videobridge2
sudo systemctl status nginx
```

Logs:

```bash
sudo journalctl -u jitsi-videobridge2 -n 200 --no-pager
sudo journalctl -u jicofo -n 200 --no-pager
sudo journalctl -u prosody -n 200 --no-pager
```

## Upgrade-Prozess

```bash
sudo apt update
sudo apt install --only-upgrade jitsi-meet jitsi-videobridge2 jicofo prosody -y
sudo systemctl restart prosody jicofo jitsi-videobridge2 nginx
```

Kurz prüfen:

- Join/Leave funktioniert
- Audio/Video stabil
- Kein Zertifikatsfehler

## Rollback (einfach)

Falls Störung auftritt:

1. In Frontend-Config temporär auf public Jitsi zurückstellen:

```env
VITE_JITSI_BASE_URL=https://meet.jit.si
```

2. Frontend neu deployen
3. Ursachenanalyse auf Jitsi-Host

## Notizen für späteren Ausbau

- TURN-Server ergänzen für restriktive Netze
- Authentifizierung (JWT/Lobby) aktivieren
- Polling-basierte Einladungen spaeter bei Bedarf durch WebSocket/SSE ersetzen
- Separate JVB-Knoten für höhere Last
- Monitoring mit Prometheus/Grafana

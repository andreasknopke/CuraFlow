# Server

Dieses Verzeichnis enthaelt den separaten Express-Backend-Server fuer CuraFlow.

## Wofuer es gedacht ist

- Backend-Tests und lokale API-Ausfuehrung
- Railway-Kompatibilitaet fuer bestehende Deployments
- Migrationen, Startskripte und Server-Hilfswerkzeuge

Die Hauptanwendung im Projektwurzelverzeichnis ist das React/Vite-Frontend. Dieses `server/`-Verzeichnis bleibt vor allem fuer Backend-Betrieb, Migrationen und vorhandene Railway-Setups erhalten.

## Schnellstart

```bash
cd server
npm install
npm start
```

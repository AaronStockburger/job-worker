# Zeebe Job-Worker für Risiko-Analyse

Ein Camunda 8 Job-Worker, der Jobs vom Typ `risk-analysis` verarbeitet und Risikobewertungen von einem lokalen JSON-Server abruft.

## Voraussetzungen

- **Node.js** (v18 oder höher)
- **pnpm** (Paketmanager)
- **Camunda 8 SaaS Account** mit API-Credentials
- **JSON-Server** mit Risikodaten auf `http://localhost:3000`

## Installation

```bash
pnpm install
```

## Konfiguration

Erstelle eine `.env`-Datei im Projektverzeichnis mit deinen Camunda Cloud Credentials:

```env
ZEEBE_ADDRESS=<cluster-id>.bru-2.zeebe.camunda.io:443
ZEEBE_CLIENT_ID=<client-id>
ZEEBE_CLIENT_SECRET=<client-secret>
ZEEBE_AUTHORIZATION_SERVER_URL=https://login.cloud.camunda.io/oauth/token
```

Die Credentials findest du in der [Camunda Console](https://console.cloud.camunda.io/) unter deinem Cluster → API → Client Credentials.

## Server starten

```bash
pnpm start
```

Der Worker verbindet sich mit Camunda Cloud und wartet auf Jobs vom Typ `risk-analysis`.

## Funktionsweise

1. Der Worker empfängt einen Job mit optionaler `riskId` (Standard: 1)
2. Er ruft `http://localhost:3000/riskEvaluations/{riskId}` auf
3. Die Risikodaten werden als Prozessvariablen zurückgegeben

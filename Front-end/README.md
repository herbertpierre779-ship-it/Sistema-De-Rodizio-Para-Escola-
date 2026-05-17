# Front-end - Cantina

Aplicacao web React + Vite do sistema da cantina.

## Requisitos

- Node.js 20+
- Backend rodando em `http://127.0.0.1:8000` (padrao do proxy do Vite)

## Setup local

```bash
cd Front-end
npm install
copy .env.example .env
```

Se quiser usar o proxy local do Vite, deixe `VITE_API_URL` vazio no `.env`.

## Executar

```bash
cd Front-end
npm run dev
```

Quando estiver rodando localmente:

- App: `http://localhost:5173`

## Build

```bash
cd Front-end
npm run build
```

## Testes

```bash
cd Front-end
npm test -- --run
```

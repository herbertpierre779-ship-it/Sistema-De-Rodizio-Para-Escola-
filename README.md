# Sistema de Rodizio de Almoco - Cantina

Projeto full stack para operacao de refeicoes escolares com cadastro de alunos, reconhecimento facial, validacao por CPF, permissao por perfil e estatisticas.

## Tecnologias Utilizadas

- Front-end: React + TypeScript + Vite + Tailwind CSS
- Back-end: Python + FastAPI + Pydantic
- Persistencia: SQLite + JSON

## Status do Projeto

finalizado 

## Como rodar (novo ambiente)

1. Clone o repositorio.
2. Configure e suba o back-end (detalhes em `back-end/README.md`).
3. Configure e suba o front-end (detalhes em `Front-end/README.md`).

Resumo rapido:

```bash
# backend
cd back-end
python -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

```bash
# frontend
cd Front-end
npm install
copy .env.example .env
npm run dev
```

## Modelos faciais obrigatorios

Coloque estes arquivos em `back-end/models`:

- `face_detection_yunet_2023mar.onnx`
- `face_recognition_sface_2021dec.onnx`

Sem esses modelos, o back-end nao inicia (comportamento esperado).

## Documentacao local

- API: `http://localhost:8000`
- Swagger: `http://localhost:8000/docs`
- Front-end: `http://localhost:5173`

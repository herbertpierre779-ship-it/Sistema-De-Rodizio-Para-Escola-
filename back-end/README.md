# Back-end - Cantina

API em FastAPI para autenticacao, cadastro, reconhecimento facial, operacao e estatisticas.

## Requisitos

- Python 3.11+
- Modelos ONNX em `back-end/models`:
  - `face_detection_yunet_2023mar.onnx`
  - `face_recognition_sface_2021dec.onnx`

Importante: sem esses 2 arquivos, a API sobe com erro (fail-fast), por seguranca.

## Setup local

```bash
cd back-end
python -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

Criar `.env` a partir do exemplo:

```bash
copy .env.example .env
```

## Executar

```bash
cd back-end
.venv\Scripts\activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Quando estiver rodando localmente:

- API: `http://localhost:8000`
- Docs: `http://localhost:8000/docs`

## Testes

```bash
cd back-end
.venv\Scripts\activate
python -m pytest
```

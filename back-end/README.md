# Cantina Backend

API FastAPI criada em `back-end/` para atender o frontend React/Vite sem assumir a implementacao final do MySQL. O projeto trabalha com contratos de persistencia em `app/repositories/contracts.py` e, por enquanto, usa um adaptador JSON local para desenvolvimento e testes.

## Stack

- Python 3.10 ou 3.11
- FastAPI + Pydantic
- JWT Bearer
- CORS liberado para localhost e IPs privados da rede local
- Adaptador provisorio em JSON
- Reconhecimento facial com prioridade para `face_recognition` e fallback para OpenCV

## Fluxo atual

- Fotos dos alunos ficam em `fotos/<ano>/<turma_slug>/<student_id>.<ext>`
- Os anos disponiveis sao fixos: `1 ano`, `2 ano`, `3 ano`
- O frontend consome as fotos por `/media/...`
- O tipo de refeicao operacional agora e `almoco`, `merenda` ou `sem_rodizio`
- As estatisticas usam a data local da escola com janela movel dos ultimos 7 dias

## Estrutura

- `app/api/routes`: rotas HTTP
- `app/schemas`: contratos tipados de request/response
- `app/services`: regras de negocio
- `app/repositories`: contratos de persistencia para handoff ao colega do banco
- `app/adapters`: implementacoes provisorias de infraestrutura

## Executar

```bash
cd back-end
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
pip install -r requirements-face.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Se `face_recognition` nao estiver instalado, a API continua funcionando com fallback. Para testes automatizados, existe tambem o modo `mock` com `CANTINA_FACE_ENGINE=mock`.

## Variaveis principais

- `CANTINA_PHOTOS_ROOT`: pasta raiz das fotos, por exemplo `C:\Users\fa285\Downloads\cantina\fotos`
- `CANTINA_FRONTEND_ORIGINS_RAW`: origens permitidas do frontend
- `CANTINA_BOOTSTRAP_DIRECTOR_USERNAME`
- `CANTINA_BOOTSTRAP_DIRECTOR_PASSWORD`
- `CANTINA_BOOTSTRAP_DIRECTOR_FULL_NAME`
- `CANTINA_SCHOOL_TIMEZONE`

## Testes

```bash
cd back-end
pytest
```

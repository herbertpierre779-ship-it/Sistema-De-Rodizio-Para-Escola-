# 🍽️ Back-end — Sistema de Rodízio de Almoço

## 📖 Sobre

Este é o **back-end da API** do sistema da cantina escolar.  
Ele centraliza:

- autenticação de usuários
- cadastro de alunos e turmas
- matrícula facial (3 fotos ou 100 fotos)
- reconhecimento facial e validação por CPF
- registro de refeições e bloqueio de duplicidade
- estatísticas e configurações do sistema

---

## 🛠️ Tecnologias Utilizadas

- 🐍 **Python 3.11+**
- ⚡ **FastAPI**
- 🧩 **Pydantic**
- 🔐 **JWT (Bearer Token)**
- 🗄️ **SQLite** (dados principais)
- 🧾 **JSON** (`meal_entries` e `recognition_attempts`)
- ✅ **Pytest** (testes)

---

## 🚀 Como executar

```bash
cd back-end
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
pip install -r requirements-face.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Quando estiver rodando localmente, a API fica disponível em:

- `http://localhost:8000`

Documentação automática local:

- `http://localhost:8000/docs`

---

## 🗂️ Estrutura (resumo)

- `app/api/routes` → rotas HTTP
- `app/schemas` → contratos de request/response
- `app/services` → regras de negócio
- `app/repositories` → contratos de persistência
- `app/adapters/persistence` → SQLite + JSON stores/repositories
- `app/core` → config, container, segurança e utilitários
- `tests` → testes automatizados da API

---

## 🧠 Persistência atual

- **SQLite (`cantina.db`)**:
  - usuários
  - turmas
  - alunos
  - embeddings faciais
  - configurações (`app_settings`)

- **JSON dedicado**:
  - `back-end/data/meal_entries.json` (entradas/atendimentos)
  - `back-end/data/recognition_attempts.json` (tentativas de reconhecimento)

---

## ⚙️ Variáveis principais

Use o `.env.example` como base.  
As mais usadas:

- `CANTINA_DATABASE_FILE`
- `CANTINA_MEAL_ENTRIES_FILE`
- `CANTINA_RECOGNITION_ATTEMPTS_FILE`
- `CANTINA_PHOTOS_ROOT`
- `CANTINA_BOOTSTRAP_DIRECTOR_USERNAME`
- `CANTINA_BOOTSTRAP_DIRECTOR_PASSWORD`
- `CANTINA_BOOTSTRAP_DIRECTOR_FULL_NAME`
- `CANTINA_SCHOOL_TIMEZONE`

---

## 🧪 Testes

```bash
cd back-end
python -m pytest
```

Checagem de sintaxe:

```bash
cd back-end
python -m compileall app
```

---

## 📌 Observações

- O reconhecimento continua funcional em modo fallback quando o engine principal não está disponível.
- O diretório de fotos é organizado por `ano/turma/nome-do-aluno`.
- Endpoints e contratos públicos foram mantidos compatíveis durante as mudanças recentes.

---

## 🚧 Status do Back-end

🚧 Em desenvolvimento

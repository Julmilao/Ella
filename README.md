# ELLA SO — Central de Operações

Sistema interno de gestão de OS e automação de lançamentos no Sankhya Experience.

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind CSS |
| Backend | Python 3.14 + FastAPI + Uvicorn |
| Banco de dados | Supabase (PostgreSQL) |
| Automação RPA | Playwright (Chromium headless) |
| Planilha | Google Sheets API |
| Hospedagem backend | Render (Web Service) |
| Hospedagem frontend | Render (Static Site) |
| Agendador | APScheduler |

---

## Pré-requisitos

- Node.js 18+
- Python 3.11+
- Conta Supabase
- Credenciais Google Service Account com acesso à planilha

---

## Variáveis de ambiente

### Frontend — `.env` (raiz do projeto)

```env
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon key>
VITE_API_URL=http://localhost:8000        # Em produção: URL do Render backend
```

### Backend — `backend/.env`

```env
SPREADSHEET_ID=<id da planilha Google>
SHEETS_DEFAULT_TAB=042026
SHEETS_STATUS_COLUMN=Status experience
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_KEY=<service role key>
GOOGLE_SERVICE_ACCOUNT_FILE=credentials.json   # ou GOOGLE_CREDENTIALS_B64 em produção
CORS_ALLOW_ORIGINS=http://localhost:8080,https://seu-site.onrender.com
```

---

## Rodando localmente

```bash
# 1. Instalar dependências do frontend
npm install

# 2. Instalar dependências do backend
cd backend
pip install -r requirements.txt
playwright install chromium

# 3. Iniciar o backend (novo terminal)
cd backend
uvicorn main:app --reload --port 8000

# 4. Iniciar o frontend (novo terminal, raiz do projeto)
npm run dev
```

Frontend disponível em `http://localhost:8081` (ou 8080 se a porta estiver livre).

---

## Deploy no Render

### Backend (Web Service)

| Campo | Valor |
|---|---|
| Runtime | Python 3 |
| Root Directory | `backend` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `playwright install chromium && uvicorn main:app --host 0.0.0.0 --port $PORT` |

Variáveis de ambiente: configurar no painel do Render (mesmas do `backend/.env`).

### Frontend (Static Site)

| Campo | Valor |
|---|---|
| Build Command | `npm run build` |
| Publish Directory | `dist` |
| `VITE_API_URL` | URL do backend no Render |

---

## Módulos do sistema

### Abertura Automática OS
Executa o lançamento de OS no Sankhya Experience via RPA (Playwright headless).  
Fonte de dados: Google Sheets ou banco de dados (Lançamentos).

### Lançamento OS
Cadastro manual de apontamentos de OS com controle de status, horas e executante.

### Saldo de Horas
Consulta o saldo de horas disponível por colaborador no Sankhya Experience.

### Apontamento Automático
Apontamento automático de OS via tela de Tarefas do Sankhya Experience.

### Rotinas / Envios / Modelos de Email
Agendamento automático de execuções e envio de emails via APScheduler.

### Clientes
Cadastro de clientes com configurações de URLs do Experience e credenciais RPA.

### Usuários
Gerenciamento de usuários e permissões de acesso por módulo.

---

## Estrutura do projeto

```
├── backend/
│   ├── main.py                    # FastAPI app principal
│   ├── requirements.txt
│   ├── core/
│   │   ├── automacao/
│   │   │   ├── sankhya.py         # RPA Playwright (login + abertura OS)
│   │   │   ├── abertura_os.py     # Orquestrador de abertura de OS
│   │   │   └── apontamento_tarefa.py
│   │   ├── auth.py
│   │   └── db.py
│   ├── routers/
│   │   ├── clientes.py
│   │   ├── usuarios.py
│   │   └── ...
│   └── scheduler/
│       └── runner.py              # APScheduler
├── src/
│   ├── pages/
│   │   ├── AutomacaoOS.tsx        # Abertura automática
│   │   ├── LancamentoOS.tsx       # Lançamento manual
│   │   └── ...
│   └── services/
│       └── api.ts                 # Funções de chamada ao backend
└── supabase/
    └── migrations/                # Migrações do banco de dados
```

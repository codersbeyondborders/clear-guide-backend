# ClearGuide — Backend

> **AI-native product intelligence platform** backend — API Gateway + multi-agent AI mesh for transforming static equipment manuals into intelligent, accessible experiences. Built for the XPRIZE Hackathon.

[![Node.js](https://img.shields.io/badge/Node.js-18+-green?logo=nodedotjs)](https://nodejs.org)
[![Fastify](https://img.shields.io/badge/Fastify-TypeScript-black?logo=fastify)](https://fastify.dev)
[![Python](https://img.shields.io/badge/Python-3.11+-blue?logo=python)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-AI%20Mesh-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![Gemini](https://img.shields.io/badge/Google-Gemini%201.5-4285F4?logo=google)](https://deepmind.google/technologies/gemini/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector-336791?logo=postgresql)](https://github.com/pgvector/pgvector)

---

## What is ClearGuide?

ClearGuide bridges the gap between complex technical documentation and real-world users — regardless of literacy level, language, or ability.

This repo contains the **entire backend** of ClearGuide:

1. **API Gateway** (`api-gateway/`) — Node.js + Fastify REST API, Firebase Auth/JWT verification, RBAC, and PostgreSQL access
2. **AI Agent Mesh** (`ai-agent-mesh/`) — Python + FastAPI multi-agent system powered by Google Gemini

---

## Architecture

```
clear-guide-backend/
├── api-gateway/                # Node.js + Fastify + TypeScript
│   └── src/
│       ├── routes/             # REST endpoints (manuals, tasks, upload)
│       └── lib/                # DB, Firebase admin, schema definitions
│
└── ai-agent-mesh/              # Python 3.11 + FastAPI + Google ADK
    └── agents/
        ├── pdf_vision_parser/      # Extracts structured data from technical PDFs
        ├── visual_search_agent/    # Camera image → part matching via vector embeddings
        ├── dynamic_video_generator/ # Auto-generates step-by-step repair videos
        ├── community_repair_agent/ # GuideBot: RAG-powered forum AI moderator
        └── accessibility_agent/    # Jargon simplification + multilingual translation
```

---

## Tech Stack

### API Gateway
| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Fastify + TypeScript |
| Auth | Firebase Admin SDK (JWT/RBAC) |
| Database | PostgreSQL + `pgvector` |
| ORM | Drizzle ORM |

### AI Agent Mesh
| Layer | Technology |
|---|---|
| Runtime | Python 3.11+ |
| Framework | FastAPI |
| Orchestration | Google Agent ADK / LangGraph |
| LLM | Google Gemini 1.5 Pro / Flash |
| Embeddings | Vertex AI Embeddings |
| Vector Store | PostgreSQL + `pgvector` |

---

## AI Agents

| Agent | Description |
|---|---|
| `PDF-Vision-Parser` | Parses uploaded technical PDFs into structured JSON, extracting tables, diagrams, and labeled parts |
| `Visual-Search-Agent` | Matches camera images against stored part vector embeddings for live identification and visual diagnostics |
| `Dynamic-Video-Generator` | Assembles SVG/canvas frame-based walkthrough videos with Gemini Vision annotations and TTS voiceovers |
| `Community-Repair-Agent` (`GuideBot`) | Monitors forum triggers, retrieves relevant manual chunks via RAG, posts verified diagnostic answers |
| `Accessibility-Translation-Agent` | Converts technical jargon to 8th-grade reading level and multi-language translations (WCAG cognitive compliance) |

---

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.11+
- PostgreSQL with `pgvector` extension enabled
- Firebase project (service account credentials)
- Google AI Studio or Vertex AI API key

### 1. Clone the Repo

```bash
git clone git@github.com:codersbeyondborders/clear-guide-backend.git
cd clear-guide-backend
```

### 2. API Gateway Setup

```bash
cd api-gateway
npm install
cp .env.example .env
```

Fill in `.env`:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/clearguide
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_SERVICE_ACCOUNT_KEY=./service-account.json
PORT=3001
```

```bash
npm run dev
```

### 3. AI Agent Mesh Setup

```bash
cd ai-agent-mesh
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Fill in `.env`:

```env
GOOGLE_API_KEY=your-gemini-api-key
DATABASE_URL=postgresql://user:password@localhost:5432/clearguide
```

```bash
uvicorn main:app --reload --port 8000
```

---

## API Endpoints

### API Gateway (`localhost:3001`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/manuals` | List all manuals |
| `GET` | `/manuals/:id` | Get a specific manual |
| `POST` | `/upload` | Upload a PDF manual for processing |
| `GET` | `/tasks/:id` | Check processing task status |

### AI Agent Mesh (`localhost:8000`)

| Method | Path | Agent |
|---|---|---|
| `POST` | `/parse-pdf` | PDF-Vision-Parser |
| `POST` | `/visual-search` | Visual-Search-Agent |
| `POST` | `/generate-video` | Dynamic-Video-Generator |
| `POST` | `/community-reply` | Community-Repair-Agent |
| `POST` | `/translate` | Accessibility-Translation-Agent |

---

## User Roles (RBAC)

| Role | Permissions |
|---|---|
| `admin` | Full platform access |
| `enterprise_author` | Create, edit, publish manuals |
| `technician` | View manuals, submit repair reports |
| `end_user` | Browse, search, community participation |

---

## Related Repos

| Repo | Description |
|---|---|
| [`clear-guide-frontend`](https://github.com/codersbeyondborders/clear-guide-frontend) | Next.js 15 web app |

---

## Contributing

This project is part of the **XPRIZE Hackathon**. Contributions from the team are welcome — please branch off `main` and open a PR.

---

*Built with ❤️ by Coders Beyond Borders*

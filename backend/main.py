"""
Hubzy Astro-Triage — Copiloto de Salud Invisible y Triaje Autónomo.

API + frontend estático en un solo proceso. Funciona 100% offline:
  - RAG: Qdrant si está en QDRANT_URL, si no store vectorial en memoria.
  - Narración: Ollama si está en OLLAMA_URL, si no plantilla determinista.

Endpoints:
  GET  /                  -> consola web
  GET  /api/status        -> modo de operación (local/híbrido) y conteos
  GET  /api/protocols     -> documentos indexados
  POST /api/assessment    -> métricas -> triaje + tarjeta de acción
"""

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from narrator import narrate, ollama_available
from retriever import Retriever
from triage import Metrics, evaluate

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("astro_triage")

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"
DATA_DIR = BASE_DIR / "data"

app = FastAPI(title="Hubzy Astro-Triage", version="0.1.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

retriever = Retriever(DATA_DIR / "protocols.json")


class AssessmentRequest(BaseModel):
    blink_rate: float | None = None
    blink_delta_pct: float | None = None
    blink_duration_ms: float | None = None
    perclos: float | None = None
    yawn_count: int | None = None
    facial_asymmetry: float | None = None
    ear_asymmetry: float | None = None
    head_sway: float | None = None
    mean_latency_ms: float | None = None
    latency_delta_pct: float | None = None
    error_rate: float | None = None
    lapse_count: int | None = None
    hr_bpm: float | None = None
    rppg_hr: float | None = None
    hrv_rmssd_ms: float | None = None
    gaze_away_pct: float | None = None
    face_tension: float | None = None
    sclera_redness: float | None = None
    hr_baseline_bpm: float | None = None
    notes: str = ""
    psych_answers: list[str] = []
    lang: str = "es"


@app.get("/api/status")
def status():
    ollama_up = ollama_available()
    return {
        "service": "hubzy-astro-triage",
        "vector_store": retriever.backend_name,
        "llm": "ollama" if ollama_up else "template-local",
        "protocols_indexed": retriever.doc_count,
        "earth_link": "offline-autonomous",
        "mode": "hybrid" if (retriever.backend_name == "qdrant" and ollama_up) else "local-autonomous",
    }


@app.get("/api/protocols")
def protocols():
    return {"count": len(retriever.all_docs()), "docs": retriever.all_docs()}


@app.post("/api/assessment")
def assessment(req: AssessmentRequest):
    m = Metrics(**req.model_dump())
    assessment = evaluate(m)
    sources = retriever.search(assessment["rag_query"], top_k=3)
    card = narrate(assessment, sources, lang=req.lang)
    return {
        **{k: v for k, v in assessment.items() if k != "rag_query"},
        "action_card": card["text"],
        "generated_by": card["generated_by"],
        "sources": [
            {
                "id": s["payload"]["id"],
                "title": s["payload"]["title"],
                "section": s["payload"]["section"],
                "score": s["score"],
            }
            for s in sources
        ],
    }


# --- Frontend estático --------------------------------------------------------
@app.get("/")
def index():
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)

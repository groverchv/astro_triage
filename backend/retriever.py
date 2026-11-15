"""
Recuperación semántica offline-first para Hubzy Astro-Triage.

Embeddings deterministas locales (hashing bag-of-words, sin API externa).
Si un servidor Qdrant está disponible en QDRANT_URL (por defecto
http://localhost:6333) indexa allí; si no, usa un store en memoria con la
misma interfaz — el demo funciona idéntico en ambos modos.
"""

import hashlib
import json
import logging
import math
import os
import re
from pathlib import Path

logger = logging.getLogger("astro_triage.retriever")

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
COLLECTION = "astro_triage_protocols"
EMB_DIM = 384

_TOKEN_RE = re.compile(r"[a-záéíóúñü0-9]+", re.IGNORECASE)

# Stopwords mínimas ES/EN para mejorar la señal del hashing
_STOP = {
    "el", "la", "los", "las", "de", "del", "en", "y", "o", "a", "un", "una",
    "que", "se", "su", "sus", "al", "con", "por", "para", "es", "lo", "como",
    "the", "of", "and", "to", "in", "a", "is", "on", "for", "an", "or",
}


def _tokens(text: str) -> list[str]:
    return [t for t in _TOKEN_RE.findall(text.lower()) if t not in _STOP]


def embed(text: str) -> list[float]:
    """Embedding determinista: bag-of-words hasheado con peso IDF aproximado."""
    vec = [0.0] * EMB_DIM
    toks = _tokens(text)
    if not toks:
        return vec
    # bigramas + unigramas para capturar frases ("frecuencia cardiaca")
    feats = toks + [f"{toks[i]}_{toks[i+1]}" for i in range(len(toks) - 1)]
    for f in feats:
        h = int(hashlib.md5(f.encode("utf-8")).hexdigest(), 16)
        idx = h % EMB_DIM
        sign = 1.0 if (h >> 8) & 1 else -1.0
        vec[idx] += sign * (1.0 / math.sqrt(len(feats)))
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def _cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


class _MemoryStore:
    """Store vectorial en memoria con la misma interfaz que el backend Qdrant."""

    def __init__(self):
        self._points: list[dict] = []

    def upsert(self, docs: list[dict]) -> None:
        self._points = docs

    def search(self, vector: list[float], top_k: int) -> list[dict]:
        scored = [
            (_cosine(vector, p["vector"]), p["payload"])
            for p in self._points
        ]
        scored.sort(key=lambda s: s[0], reverse=True)
        return [{"score": round(s, 4), "payload": pl} for s, pl in scored[:top_k]]

    def count(self) -> int:
        return len(self._points)


class _QdrantStore:
    def __init__(self, url: str):
        from qdrant_client import QdrantClient
        from qdrant_client.http import models as qm

        self._qm = qm
        self._client = QdrantClient(url=url, timeout=3)
        # Fuerza una llamada real para validar conectividad
        self._client.get_collections()
        if not self._client.collection_exists(COLLECTION):
            self._client.create_collection(
                collection_name=COLLECTION,
                vectors_config=qm.VectorParams(size=EMB_DIM, distance=qm.Distance.COSINE),
            )

    def upsert(self, docs: list[dict]) -> None:
        points = [
            self._qm.PointStruct(id=i, vector=d["vector"], payload=d["payload"])
            for i, d in enumerate(docs)
        ]
        self._client.upsert(collection_name=COLLECTION, points=points)

    def search(self, vector: list[float], top_k: int) -> list[dict]:
        res = self._client.query_points(
            collection_name=COLLECTION, query=vector, limit=top_k
        )
        return [
            {"score": round(p.score, 4), "payload": p.payload}
            for p in res.points
        ]

    def count(self) -> int:
        return self._client.count(collection_name=COLLECTION).count


class Retriever:
    """Fachada: Qdrant si está vivo, memoria local si no. Misma API."""

    def __init__(self, protocols_path: Path):
        self._docs = json.loads(protocols_path.read_text(encoding="utf-8"))
        self.backend_name = "memory"
        try:
            self._store = _QdrantStore(QDRANT_URL)
            self.backend_name = "qdrant"
        except Exception as e:
            logger.info("Qdrant no disponible (%s); usando store en memoria.", e)
            self._store = _MemoryStore()
        self._ingest()

    def _ingest(self) -> None:
        docs = []
        for d in self._docs:
            full = f"{d['title']}. {d['section']}. {' '.join(d['tags'])}. {d['text']}"
            docs.append({
                "vector": embed(full),
                "payload": {k: d[k] for k in ("id", "title", "section", "tags", "text")},
            })
        self._store.upsert(docs)
        logger.info("Indexados %d protocolos en %s", len(docs), self.backend_name)

    def search(self, query: str, top_k: int = 3) -> list[dict]:
        return self._store.search(embed(query), top_k)

    @property
    def doc_count(self) -> int:
        return self._store.count()

    def all_docs(self) -> list[dict]:
        return self._docs

#!/usr/bin/env bash
# Hubzy Astro-Triage — arranque (Linux/macOS/Git Bash)
set -e
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
    echo "Creando entorno virtual..."
    python -m venv .venv
fi

source .venv/Scripts/activate 2>/dev/null || source .venv/bin/activate
pip install -q -r backend/requirements.txt

echo ""
echo "=== HUBZY ASTRO-TRIAGE ==="
echo "Consola: http://127.0.0.1:8000"
echo "(Opcional: Qdrant en :6333 y Ollama en :11434 activan modo híbrido)"
echo ""

cd backend
uvicorn main:app --host 127.0.0.1 --port 8000

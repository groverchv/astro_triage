# Hubzy Astro-Triage — arranque (Windows PowerShell)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".venv")) {
    Write-Host "Creando entorno virtual..." -ForegroundColor Cyan
    python -m venv .venv
}

& .\.venv\Scripts\Activate.ps1
pip install -q -r backend\requirements.txt

Write-Host ""
Write-Host "=== HUBZY ASTRO-TRIAGE ===" -ForegroundColor Cyan
Write-Host "Consola: http://127.0.0.1:8000" -ForegroundColor Green
Write-Host "(Opcional: Qdrant en :6333 y Ollama en :11434 activan modo híbrido)" -ForegroundColor DarkGray
Write-Host ""

Set-Location backend
uvicorn main:app --host 127.0.0.1 --port 8000

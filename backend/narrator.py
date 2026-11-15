"""
Generación de la tarjeta de acción — Hubzy Astro-Triage.

Primario: LLM local vía Ollama (OLLAMA_URL, modelo OLLAMA_MODEL) con timeout
agresivo — en el espacio profundo no hay red, si Ollama no responde en ~4 s
se cae al generador determinista por plantilla, que siempre produce la tarjeta.
"""

import json
import logging
import os
import urllib.request

logger = logging.getLogger("astro_triage.narrator")

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1")
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "4"))

_LEVEL_ES = {
    "NOMINAL": "NOMINAL",
    "VERDE": "VERDE — observación",
    "AMBAR": "ÁMBAR — contramedidas activas",
    "ROJO": "ROJO — emergencia a bordo",
}


def ollama_available() -> bool:
    try:
        req = urllib.request.Request(f"{OLLAMA_URL}/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=1.5) as r:
            return r.status == 200
    except Exception:
        return False


def _ollama_generate(prompt: str) -> str | None:
    body = json.dumps({
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": 400},
    }).encode("utf-8")
    try:
        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/generate", data=body,
            headers={"Content-Type": "application/json"}, method="POST",
        )
        with urllib.request.urlopen(req, timeout=OLLAMA_TIMEOUT) as r:
            return json.loads(r.read().decode("utf-8")).get("response", "").strip()
    except Exception as e:
        logger.info("Ollama no respondió (%s) — usando plantilla.", e)
        return None


def _template_card(assessment: dict, sources: list[dict]) -> str:
    """Generador determinista: tarjeta en lenguaje claro, pasos accionables."""
    level = assessment["triage_level"]
    findings = assessment["findings"]
    composites = assessment["composites"]

    lines = [f"▸ VEREDICTO: {_LEVEL_ES.get(level, level)}", ""]

    if not findings:
        lines += [
            "Todo normal — sigues en tu línea base.",
            "",
            "  1. Mantén tu plan de hoy tal cual.",
            "  2. Repite el reto mañana a la misma hora.",
        ]
    else:
        if composites:
            lines += [f"Patrón: {composites[0]}", ""]
        steps = []
        for f in findings:
            s = f.get("step")
            if s and s not in steps:
                steps.append(s)
        if not steps:
            steps.append("Registra el evento y reevalúa en 12 h.")
        lines.append("Haz esto:")
        for i, s in enumerate(steps[:3], 1):
            lines.append(f"  {i}. {s}")
        if level == "ROJO":
            lines += ["", "⚠ Avisa a otro tripulante y abre canal médico ahora."]
        elif level == "AMBAR":
            lines += ["", "⚠ Hoy sin EVA ni tareas críticas — reevalúa en 4 h."]

    lines += ["", "— IA local · no es diagnóstico médico"]
    return "\n".join(lines)


def narrate(assessment: dict, sources: list[dict]) -> dict:
    """Devuelve {'text': str, 'generated_by': 'ollama'|'template'}."""
    if ollama_available():
        findings_txt = "; ".join(
            f"{f['code']}: {f['detail']}" for f in assessment["findings"]
        ) or "todos los dominios nominales"
        src_txt = "\n".join(
            f"- {s['payload']['id']} {s['payload']['title']}: {s['payload']['text'][:400]}"
            for s in sources[:3]
        )
        prompt = (
            "Eres el copiloto médico autónomo de una nave en misión a Marte, sin "
            "enlace con la Tierra. Genera una TARJETA DE ACCIÓN breve y directa en "
            "español para el astronauta (máx. 200 palabras): nivel de triaje, "
            "patrón detectado, y 3-4 contramedidas numeradas citando el protocolo. "
            "Tono operativo, sin rodeos.\n\n"
            f"Nivel: {assessment['triage_level']}\n"
            f"Hallazgos: {findings_txt}\n"
            f"Patrones: {'; '.join(assessment['composites']) or 'ninguno'}\n"
            f"Protocolos relevantes:\n{src_txt}\n\n"
            "TARJETA DE ACCIÓN:"
        )
        text = _ollama_generate(prompt)
        if text:
            return {"text": text, "generated_by": f"ollama/{OLLAMA_MODEL}"}
    return {"text": _template_card(assessment, sources), "generated_by": "template-local"}

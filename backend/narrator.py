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
_LEVEL_EN = {
    "NOMINAL": "NOMINAL",
    "VERDE": "GREEN — monitor",
    "AMBAR": "AMBER — active countermeasures",
    "ROJO": "RED — onboard emergency",
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


def _template_card(assessment: dict, sources: list[dict], lang: str = "es") -> str:
    """Generador determinista: tarjeta en lenguaje claro, pasos accionables."""
    level = assessment["triage_level"]
    findings = assessment["findings"]
    composites = assessment["composites"]
    en = lang == "en"
    LEVEL = _LEVEL_EN if en else _LEVEL_ES

    lines = [f"▸ {'VERDICT' if en else 'VEREDICTO'}: {LEVEL.get(level, level)}", ""]

    if not findings:
        lines += (
            [
                "All nominal — you're at your baseline.",
                "",
                "  1. Keep today's plan as is.",
                "  2. Repeat the challenge tomorrow at the same time.",
            ] if en else [
                "Todo normal — sigues en tu línea base.",
                "",
                "  1. Mantén tu plan de hoy tal cual.",
                "  2. Repite el reto mañana a la misma hora.",
            ]
        )
    else:
        if composites:
            lines += [f"{'Pattern' if en else 'Patrón'}: {composites[0]}", ""]
        steps = []
        for f in findings:
            s = f.get("step")
            if s and s not in steps:
                steps.append(s)
        if not steps:
            steps.append(
                "Log the event and re-check in 12 h." if en else
                "Registra el evento y reevalúa en 12 h."
            )
        lines.append("Do this:" if en else "Haz esto:")
        for i, s in enumerate(steps[:3], 1):
            lines.append(f"  {i}. {s}")
        if level == "ROJO":
            lines += ["", "⚠ Alert another crew member and open the medical channel now." if en
                      else "⚠ Avisa a otro tripulante y abre canal médico ahora."]
        elif level == "AMBAR":
            lines += ["", "⚠ No EVA or critical tasks today — re-check in 4 h." if en
                      else "⚠ Hoy sin EVA ni tareas críticas — reevalúa en 4 h."]

    lines += ["", "— Local AI · not a medical diagnosis" if en
              else "— IA local · no es diagnóstico médico"]
    return "\n".join(lines)


def narrate(assessment: dict, sources: list[dict], lang: str = "es") -> dict:
    """Devuelve {'text': str, 'generated_by': 'ollama'|'template'}."""
    lang = "en" if str(lang or "").lower().startswith("en") else "es"
    if ollama_available():
        findings_txt = "; ".join(
            f"{f['code']}: {f['detail']}" for f in assessment["findings"]
        ) or ("all domains nominal" if lang == "en" else "todos los dominios nominales")
        src_txt = "\n".join(
            f"- {s['payload']['id']} {s['payload']['title']}: {s['payload']['text'][:400]}"
            for s in sources[:3]
        )
        prompt = (
            (
                "You are the autonomous medical copilot of a ship on a Mars "
                "mission, with no link to Earth. Generate a brief, direct "
                "ACTION CARD in English for the astronaut (max. 200 words): "
                "triage level, detected pattern, and 3-4 numbered "
                "countermeasures citing the protocol. Operational tone, "
                "no fluff.\n\n"
                f"Level: {assessment['triage_level']}\n"
                f"Findings: {findings_txt}\n"
                f"Patterns: {'; '.join(assessment['composites']) or 'none'}\n"
                f"Relevant protocols:\n{src_txt}\n\n"
                "ACTION CARD:"
            ) if lang == "en" else (
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
        )
        text = _ollama_generate(prompt)
        if text:
            return {"text": text, "generated_by": f"ollama/{OLLAMA_MODEL}"}
    return {"text": _template_card(assessment, sources, lang), "generated_by": "template-local"}

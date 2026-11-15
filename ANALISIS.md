# HUBZY ASTRO-TRIAGE — Análisis completo del proyecto

> Documento de estado al **15/11/2026**. Registra todo lo implementado, cómo funciona
> por dentro y dónde extender. Pensado para no perder el avance al añadir features.

---

## 1. Qué es

MVP hackathon (NASA Space Apps): **copiloto de salud invisible + triaje autónomo** para
misiones de larga duración (Marte, T-20min de delay con la Tierra).

El astronauta cree que solo juega 60 segundos de cartas con su capibara (Hubzy).
Mientras tanto la cámara mide 12 señales biométricas pasivas y el juego mide
reacción/precisión. Al terminar, el sistema fusiona todo y entrega un **veredicto
de triaje (APTO → NO APTO)** con contramedidas citando protocolos NASA — **100%
offline**, sin internet ni nube.

Herencia del concepto:
- **Hubzi** → juego de cartas, capibara mascota, gamificación, tono calmado.
- **CoachVirtual** → monitoreo por cámara con MediaPipe (aquí FaceMesh en vez de Pose).
- **Nuevo** → motor de triaje por convergencia + RAG médico local.

---

## 2. Arquitectura

```
┌─────────────────────────── NAVE (100% local) ───────────────────────────┐
│                                                                         │
│  NAVEGADOR (frontend estático, servido por FastAPI :8000)               │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────────┐    │
│  │ game.js     │  │ camera.js    │  │ app.js                      │    │
│  │ cartas 60 s │  │ MediaPipe    │  │ orquestación + render +     │    │
│  │ latencia/ms │  │ FaceMesh     │  │ POST /api/assessment        │    │
│  │ lapsus/err  │  │ 12 señales   │  │                             │    │
│  └──────┬──────┘  └──────┬───────┘  └──────────────┬──────────────┘    │
│         │  AppState.bio  │  AppState.game          │                   │
│         └────────────────┴───────────►─────────────┘                   │
│                                        │ JSON                          │
│  BACKEND FastAPI (un solo proceso)     ▼                               │
│  ┌──────────────┐  ┌────────────────┐  ┌───────────────┐              │
│  │ triage.py    │─►│ retriever.py   │─►│ narrator.py   │              │
│  │ convergencia │  │ RAG vectorial  │  │ tarjeta acción│              │
│  │ IMG-9.1      │  │ 15 protocolos  │  │               │              │
│  └──────────────┘  └───────┬────────┘  └───────┬───────┘              │
│                            │                   │                       │
│              ┌─────────────┴───┐       ┌───────┴────────┐              │
│              │ Qdrant (opc.)  │       │ Ollama (opc.)  │              │
│              │ o store memoria│       │ o plantilla    │              │
│              └────────────────┘       └────────────────┘              │
└────────────────────────────────────────────────────────────────────────┘

Cuando vuelve la línea de vista → Gemini en nube (concepto, no implementado).
```

**Principio rector**: *offline-first con degradación elegante*. Cada dependencia
externa es opcional y tiene fallback — el demo nunca muere:

| Componente | Primario | Fallback | Estado actual |
|---|---|---|---|
| Store vectorial | Qdrant (`QDRANT_URL`) | `_MemoryStore` (misma API) | `memory` (15 docs) |
| LLM narrador | Ollama (`OLLAMA_URL`, llama3.1) | plantilla determinista | `template-local` |
| Biometría | MediaPipe FaceMesh (CDN) | `Bio.simulate()` | cámara real OK |
| Juego | sesión real | `Game.simulate()` (botón DEMO) | OK |
| Pulso | rPPG cámara | input manual/wearable | ambos |

---

## 3. Estructura de archivos

```
D:\NASA 2.0\astro-triage\
├── ANALISIS.md              ← este documento
├── README.md
├── run.ps1 / run.sh         ← arranque (crea .venv si no existe + uvicorn :8000)
├── backend\
│   ├── requirements.txt     ← fastapi, uvicorn (qdrant_client es import perezoso)
│   ├── main.py              ← API + sirve frontend estático (118 líneas)
│   ├── triage.py            ← motor de triaje IMG-9.1 (471 líneas)
│   ├── retriever.py         ← embeddings hashing + Qdrant/memoria (148 líneas)
│   ├── narrator.py          ← tarjeta de acción: Ollama o plantilla (133 líneas)
│   └── data\protocols.json  ← 15 protocolos estilo NASA-STD-3001/IMG
└── frontend\
    ├── index.html           ← estructura de 3 pasos (138 líneas)
    ├── style.css            ← tema consola oscura, tokens en :root (255 líneas)
    ├── camera.js            ← Bio: FaceMesh + 12 señales (420 líneas)
    ├── game.js              ← Game: reto de cartas + basal (212 líneas)
    └── app.js               ← AppState/AppEvents, señales, veredicto (338 líneas)
```

Repos de referencia (NO modificados): `D:\NASA 2.0\Hubzi`, `D:\NASA 2.0\CoachVirtual`.

---

## 4. Flujo de usuario (stepper de 3 pasos)

```
1 · JUGAR 60s ──► 2 · SEÑALES ──► 3 · VEREDICTO
```

1. **RETO DE REACCIÓN** — el usuario pulsa `▸ JUGAR · 60 s`.
   `Game.start()` llama `Bio.start()` (cámara se enciende sola, sin bloquear).
   Se muestra SEÑAL + 5 cartas (4 símbolos + `✕ NINGUNA`). Stats de juego:
   PUNTOS / RACHA / ERRORES / TIEMPO. La capibara comenta sobrio ("Acierto.",
   "Racha en curso."). La cámara aparece como pip tipo streamer con overlay
   técnico (contornos de ojos, caja facial, línea de inclinación, punto nasal).

2. **ANÁLISIS DE LA SESIÓN** (aparece solo al terminar) — 9 tarjetas de señales
   en lenguaje humano + frase de Hubzy según peor señal + input de FC manual.

3. **VEREDICTO** — se genera **automáticamente** 1.4 s después (sin botón).
   Banner grande (APTO / APTO OBSERVACIÓN / APTO CON RESTRICCIONES / NO APTO),
   hallazgos en español claro, "QUÉ HACER" con pasos numerados, fuentes RAG,
   barra de tendencia histórica, botón 🔊 voz y línea de prueba de autonomía
   (`⚡ Generado 100% a bordo — vector/llm/sin enlace`).

Eventos: `AppEvents.emit("game")` → `renderSignals()` + `setTimeout(runTriage, 1400)`.
En `Game.finish()` el orden importa: `Bio.stop()` → `AppState.bio` → métricas juego
→ `AppState.game` → `emit("game")`. **No reordenar.**

---

## 5. Las 12 señales (camera.js)

MediaPipe FaceMesh (`refineLandmarks: true`, ~30 fps, 468+10 iris landmarks).
Warm-up de 1.5 s antes de acumular nada. API: `Bio.start()→bool`, `Bio.stop()→metrics|null`.

| # | Métrica (salida `metrics()`) | Cómo se calcula | Clave anti-ruido |
|---|---|---|---|
| 1 | `blink_rate` (parpadeos/min) | EAR adaptativo: umbral cierre = 68% del EAR abierto medido | histéresis (68%/82%), refractario 300 ms, min 2 frames cerrados |
| 2 | `blink_duration_ms` | frames cerrados/parpadeo × 33 ms | ventana de 60 parpadeos |
| 3 | `perclos` (0–1) | % frames con EAR < 78% del abierto | umbral relativo, no absoluto |
| 4 | `yawn_count` | MAR = apertura labios/ancho boca > 0.55 sostenido ≥ 0.8 s | cooldown 3 s |
| 5 | `facial_asymmetry` (0–1) | distancias L/R a nariz en 6 pares simétricos | piso de ruido 0.10 (gafas), escala ×4 |
| 6 | `ear_asymmetry` (0–1) | \|EAR_izq − EAR_der\| media | un ojo cayendo distinto = refuerzo neuro |
| 7 | `head_sway` (0–1) | temblor frame-a-frame de la nariz (no deriva) | media/0.015 cap a 1 |
| 8 | `rppg_hr` (lpm) | canal verde de frente+mejillas, detrend, picos→bpm | muestreo cada 3 frames; null si sin señal |
| 9 | `hrv_rmssd_ms` | RMSSD sobre los picos rPPG | requiere señal rPPG válida |
| 10 | `gaze_away_pct` (0–1) | iris fuera del centro ±22% del ancho ocular | landmarks iris (468/473) |
| 11 | `face_tension` (0–1) | caída ceja-ojo vs basal propia (percentil 80) + squint | basal individual en vivo |
| 12 | `sclera_redness` (0–1) | proporción de rojo en parches 6×6 px de esclerótica nasal | cada 15 frames, normalizado |

Overlay dibujado en canvas espejado: contornos oculares (verde si cerrado),
caja facial tenue, línea ámbar ojo-ojo (inclinación), punto rojo en nariz,
flash `👁×N` al parpadear y `😮×N` al bostezar.

**Bug corregido**: parpadeo 105/min (sin histéresis), estabilidad siempre 0%
(medía deriva), basal contaminada
(ya solo se guarda si media < 1500 ms).

## 6. El juego (game.js)

- 8 símbolos emoji inconfundibles: 🚀🌍⭐🔥💧⚡🌙🪐.
- Ronda: SEÑAL objetivo → 75% incluye la carta, 25% trampa (ninguna coincide →
  hay que pulsar `✕ NINGUNA`, 5ª carta del mismo tamaño).
- Métricas por sesión: `mean_latency_ms`, `latency_delta_pct` vs basal,
  `lapse_count` (>500 ms, criterio PVT), `error_rate`, `trials`.
- Puntuación: +10 por acierto + bonus min(racha,10); −3 por error.
- **Línea basal individual** en `localStorage["astro_triage_baseline_ms"]`:
  primera sesión válida la establece (guard solo si media < 1500 ms);
  el estándar NASA compara contra TU basal, no contra promedios.
- `Game.simulate()`: sesión degradada creíble (Δ≈+15-23%, errores ~18-30%,
  3-6 lapsus) para el jurado.

## 7. Motor de triaje (triage.py)

Traduce métricas a **hallazgos** con severidad y dominio, luego fusiona
(algoritmo inspirado en IMG-CHECKLIST-9.1).

Severidades: `nominal < advisory < caution < warning < critical`
(labels ES: NOMINAL/AVISO/PRECAUCIÓN/ALERTA/CRÍTICO + color).

**19 códigos de hallazgo** (cada uno con `plain` + `step` en lenguaje de
astronauta en el mapa `PLAIN`):

| Código | Dominio | Disparador principal |
|---|---|---|
| EYE-FATIGUE | ocular | parpadeo <11/min o Δ>25% |
| EYE-LID | ocular | parpadeos >400 ms |
| EYE-RED | ocular | esclerótica >0.30 |
| SLEEP-DROWSY | somnolencia | puntos compuestos PERCLOS+bostezos+duración ≥1 |

| NEURO-FACIAL | neurológico | max(asimetría facial, ear×0.9) >0.12 (critical >0.28) |
| VEST-INSTAB | vestibular | head_sway >0.25 |
| PSYCHOMOTOR-SLOW | psicomotor | Δ latencia >10% (warning >25%) |
| PVT-LAPSES | psicomotor | ≥4 lapsus (caution si ≥8) |
| COG-ERRORS | cognitivo | error_rate >18% |
| ATT-GAZE | cognitivo | mirada fuera >40% |
| FACE-TENSION | muscular | tensión >0.45 |
| CV-HRV | cardiovascular | RMSSD <25 ms |
| CV-TACHY | cardiovascular | FC >+10% basal o >88 lpm (manual tiene prioridad sobre rPPG) |
| PSYCH-MOOD | psicologico | check-in NPC: `mood:bajo`/`malo` |
| PSYCH-FATIGUE | psicologico | check-in NPC: `sleep:regular`/`mal` |
| PSYCH-ISOLATION | psicologico | check-in NPC: `social:distante`/`aislado` |
| SYM-HEAD | somatico | notes contiene "cefalea" |
| SYM-DIZZY | vestibular | notes contiene "mareo" |
| SYM-NAUSEA | somatico | notes contiene "náusea"/"nausea" |

**Fusión → nivel:**
- **ROJO**: focalidad neuro (critical) ∨ ≥3 dominios en caution+ ∨ Δ>25% ∨ algún warning.
- **ÁMBAR**: ≥2 dominios alterados ∨ Δ>15% ∨ algún caution.
- **VERDE**: hay hallazgos pero todo leve. **NOMINAL**: sin hallazgos.

**Patrones compuestos** (salen como `composites`):
- ojos/sueño + lentitud + FC alta → "Cansancio acumulado + posible deshidratación"
- lentitud + errores → "Revisar CO2 del módulo o descanso"
- inestabilidad + (FC o errores) → "Riesgo de mareo o desmayo"
- lentitud psicomotora + respuesta psicológica negativa → "Fatiga mental severa o burnout"

`rag_query` = términos de hallazgos ordenados por severidad + palabras de compuestos.

## 8. RAG (retriever.py + protocols.json)

- **Embeddings deterministas locales** (sin API externa): bag-of-words con
  unigramas+bigramas hasheados a 384 dims, signo por bit de hash, normalizado
  coseno. Stopwords ES/EN mínimas.
- `_MemoryStore` y `_QdrantStore` comparten interfaz `upsert/search/count`;
  la elección es transparente al arrancar.
- Colección Qdrant: `astro_triage_protocols` (COSINE, 384d). Timeout 3 s —
  si no responde, memoria.
- **18 protocolos** en `data/protocols.json` (id, title, section, tags, text):
  NASA-STD-3001 §4.2.1 fatiga, §4.3.2 deshidratación, §4.5.1 vestibular,
  §4.2.4 PVT, §7.1.1 CO2, §4.4.3 ARED, §5.2.1 sueño, §6.1.2 radiación,
  §4.6.1 fatiga visual, §8.3.1 evaluación pasiva; IMG-CHECKLIST 3.1 neuro,
  5.4 cefalea, 7.2 psicológico, 2.3 cardiovascular, 9.1 algoritmo de triaje,
  8.1 burnout; BHP-2.1 salud conductual/aislamiento, BHP-RES-4.7 respiración 4-7-8.

## 9. Narrador (narrator.py)

- Ping a `OLLAMA_URL/api/tags` (1.5 s). Si responde → prompt `/api/generate`
  (llama3.1, temp 0.3, máx 400 tokens, timeout 4 s agresivo).
- Si no → `_template_card`: plantilla determinista que produce
  `▸ VEREDICTO: nivel` + "Lo que vi" (plain de los 5 peores hallazgos +
  compuestos) + "Qué hacer ahora" (steps deduplicados, máx 4) + restricción
  ÁMBAR ("nada de EVA/robótica/acoplamiento, reevaluar 4 h") o prioridad ROJO
  ("avisa a otro tripulante, canal médico") + `Respaldo:` protocolos +
  disclaimer "soporte de decisión — no diagnóstico médico".
- Devuelve `{text, generated_by: "ollama/llama3.1"|"template-local"}`.

## 10. API (main.py)

| Endpoint | Descripción |
|---|---|
| `GET /` | sirve `index.html` (static mount para css/js) |
| `GET /api/status` | `{vector_store, llm, protocols_indexed, earth_link, mode}` |
| `GET /api/protocols` | documentos indexados completos |
| `POST /api/assessment` | métricas → `{triage_level, domains_altered, findings[], composites[], action_card, generated_by, sources[{id,title,section,score}]}` |

`AssessmentRequest` acepta los 19 campos de `Metrics` — todos opcionales
(null-tolerante; `mean_latency_ms` puede faltar aunque llegue `latency_delta_pct`).

CORS abierto `*`. Uvicorn en `127.0.0.1:8000`.

## 11. Frontend (app.js) — render del resultado

- `collectMetrics()` mapea `AppState.bio` + `AppState.game` + input FC manual
  (68 basal) + 13 campos cámara → POST.
- `buildSignals()` → 9 tarjetas: PARPADEO · SOMNOLENCIA · SIMETRÍA FACIAL ·
  ATENCIÓN VISUAL · TENSIÓN FACIAL · ESTABILIDAD · VELOCIDAD MENTAL ·
  PRECISIÓN · PULSO (rPPG o manual + HRV en sub). Cada una: valor,
  estado en palabras, clase ok/warn/bad/na.
- `VERDICT` map → banner por nivel; `DOMAIN_ES` traduce dominios;
  hallazgos usan `f.plain` (backend) o `f.detail` como fallback.
- **Tendencia**: `localStorage["astro_triage_history"]` (14 entradas máx,
  1/día, score por nivel 100/80/50/15), barras MM-DD.
- **Voz**: `speechSynthesis` es-ES lee título+sub+tarjeta.
- `fetchStatus()` → guarda `AppState.sysinfo` y rellena `#localProof` en el
  veredicto (única evidencia técnica visible; el header solo dice `◉ MODO AUTÓNOMO`).

## 12. UX/UI actual (decisiones tomadas)

- Tema consola oscura: mono JetBrains/Cascadia, acento cian `#38bdf8`,
  ámbar `#f59e0b`, semáforo ICAO.
- **Filosofía**: el juego no parece examen (sin badges médicos en vivo,
  sin "MONITOREO", stats de juego normales: PUNTOS/RACHA/ERRORES/TIEMPO).
  Lo clínico solo aparece DESPUÉS: señales + veredicto.
- Capibara 🦫 presente pero sobria: frases cortas neutras, no infantiles.
- Todo texto en español llano; códigos técnicos solo como IDs de fuente RAG.

## 12b. Fase 2.0 — módulos implementados (plan_de_implementaci_n_hubzy.md)

**Check-in emocional NPC (entre juego y veredicto):** modal `#hubzyModal` con
avatar Hubzy, diálogo estilo terminal con `typeText()` letra-a-letra + pitidos
8-bits aleatorios (`playBabble()`, WebAudio). 3 preguntas secuenciales
(moral/sueño/conexión) con botones "interruptor de cabina". Respuestas →
`AppState.psych_answers` (`["mood:bajo", ...]`) → `AssessmentRequest.psych_answers`
→ hallazgos `PSYCH-*` (dominio `psicologico`).

**Síntomas rápidos (antes de jugar):** fila `sym-row` con toggles 🤕cefalea /
🤢náusea / 😵‍💫mareo / 👍bien (exclusivo). Van en `notes` ("sintomas: …") →
hallazgos `SYM-*` (dominios `somatico`/`vestibular`).

**Respiración 4-7-8 (micro-intervención):** botón `◉ CALIBRACIÓN 4-7-8` en el
banner si nivel ≥ÁMBAR o hallazgos PSYCH/FACE-TENSION/CV-HRV. Modal con círculo
que escala 4s/7s/8s, 3 ciclos, contador — protocolo BHP-RES-4.7.

**Modo jurado:** `Alt+Shift+1/2/3` → `juryInject()` puebla AppState con escenarios
NOMINAL/ÁMBAR/ROJO verificados y llama `runTriage()` directo (salta juego, cámara
y modal). Presets calibrados para aterrizar el nivel exacto.

## 13. Calibración y anti-falsos-positivos (bitácora)

| Problema | Fix aplicado |
|---|---|
| Parpadeo 105/min | histéresis EAR adaptativa + refractario 300 ms + mín 2 frames |
| Balanceo siempre 1.00 | temblor frame-a-frame, no deriva; mostrado como % estabilidad |
| Asimetría por gafas | piso de ruido 0.10 |
| Detección de cabezazos | **eliminada**: mirar abajo a la pantalla la disparaba — falsos positivos inevitables sin aportar precisión |
| Basal 3796 ms contaminada | solo persiste si media <1500 ms |
| Crash `mean_latency_ms=None` | fallback seguro antes de formatear |

## 14. Cómo extender (puntos de inserción)

**Añadir una señal nueva** (ej. respiración con Pose):
1. `camera.js` → acumular en `state`, exponer en `metrics()`.
2. `app.js` → pasarla en `collectMetrics()` + tarjeta en `buildSignals()`.
3. `backend/main.py` → campo en `AssessmentRequest`.
4. `backend/triage.py` → campo en `Metrics`, bloque de evaluación con
   umbral→severidad, `Finding` con `query_terms`, entrada `PLAIN` (plain+step).
5. Opcional: regla de fusión (dominios/compuestos) y protocolo en
   `protocols.json`.

**Añadir protocolo RAG**: nuevo objeto en `protocols.json` — se reindexa solo
al arrancar (en memoria y Qdrant).

**Cambiar reglas de triaje**: solo `triage.py` — umbrales por sección
comentada, fusión al final. Severidades no tocar fuera de SEVERITY_*.

**LLM real**: `ollama serve` + `ollama pull llama3.1` → auto-upgrade a
`generated_by: ollama/llama3.1` sin tocar código.
**Qdrant real**: `docker run -p 6333:6333 qdrant/qdrant` → `vector_store: qdrant`.

## 15. Limitaciones conocidas / honestidad técnica

- rPPG funciona con buena luz y cara quieta; si no hay señal → FC manual.
- Enrojecimiento/mirada/tensión son estimaciones por webcam; nada se presenta
  como diagnóstico (disclaimer siempre visible).
- Embeddings por hashing son aproximados, no semánticos reales; para producción
  usaría sentence-transformers o Gemini embeddings (camino ya previsto en Hubzi).
- Gafas elevan el ruido de asimetría (mitigado, no eliminado).
- `notes` del request existe pero aún no se usa en triage.py.

## 16. Roadmap sugerido (pendiente, discutido con el usuario)

- [x] Síntomas rápidos: botones mareo/cefalea/náusea/OK que alimenten `notes`/triage
- [x] Micro-intervención Hubzi: respiración 4-7-8 guiada si sale ÁMBAR
- [x] Check-in emocional NPC con typing effect + audio (estilo Loco Dave)
- [x] Modo jurado: Alt+Shift+1/2/3 inyecta NOMINAL/ÁMBAR/ROJO
- [ ] Exportar log de misión (JSON/CSV del historial)
- [ ] i18n ES/EN (jueces evalúan en inglés)
- [ ] Respiración/min con MediaPipe Pose (puente natural desde CoachVirtual)
- [ ] Expresiones/blendshapes completos (tasks-vision: 52 canales)
- [ ] Gemini en nube para recalibración cuando hay enlace (concepto ya vendido)
- [ ] NO viables por webcam (no prometer): SpO2, presión arterial, temperatura

## 17. Comandos de operación

```powershell
# Backend (puerto 8000, sirve todo) — deps instaladas en Python del sistema
cd "D:\NASA 2.0\astro-triage\backend"
python -m uvicorn main:app --host 127.0.0.1 --port 8000

# Alternativa: run.ps1 crea .venv automáticamente en el primer arranque

# Verificación rápida
curl http://127.0.0.1:8000/api/status
node --check frontend\camera.js ; node --check frontend\game.js ; node --check frontend\app.js

# Limpiar basal contaminada (consola navegador)
localStorage.removeItem("astro_triage_baseline_ms")
localStorage.removeItem("astro_triage_history")
```

Servicios hermanos (referencia, no tocar): CoachVirtual :5173, Hubzi :5174.

---

*Documento generado como snapshot del estado funcional. Última verificación:
`POST /api/assessment` con 4 señales nuevas → ÁMBAR con hallazgos correctos;
`node --check` limpio en los 3 JS; todos los assets 200.*

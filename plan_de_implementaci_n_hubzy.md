# Plan de Expansión: HUBZY ASTRO-TRIAGE (Fase 2.0)

**Contexto para el Asistente de IA (IDE):**
Este proyecto es un copiloto de salud y triaje autónomo 100% offline para astronautas (hackathon NASA Space Apps). El flujo actual de 3 pasos es: `1. Jugar 60s -> 2. Mostrar Señales -> 3. Veredicto RAG`. 
El objetivo es inyectar un **Módulo de Salud Mental Interactivo** (estilo NPC gamificado), añadir botones de triaje rápido, micro-intervenciones (4-7-8) y un modo de demostración para los jueces.

**Regla de oro:** No romper la arquitectura `offline-first` ni el sistema de fallbacks actuales.

---

## FASE 1: Check-in Emocional Gamificado (Estilo "Loco Dave" en el Espacio)
**Objetivo:** Interceptar el flujo entre el fin del juego y el veredicto para hacer preguntas de salud mental mediante el NPC Hubzy (capibara).

### 1.1 UI/UX: Modal Temático (Modificar `frontend/index.html` y `frontend/style.css`)
- **HTML:** Crear un `<div id="hubzy-mental-check">` oculto. Debe contener:
  - Imagen/Avatar animado de Hubzy.
  - Caja de diálogo (estilo terminal retro).
  - Contenedor para botones de respuesta.
- **CSS:** Estilo robusto/ciencia ficción. 
  - Los botones de respuesta deben parecer "interruptores de cabina" o "rocas espaciales" (bordes gruesos, sombras `box-shadow` marcadas, efectos `:hover` luminosos).
  - La caja de diálogo debe encajar con el tema consola oscura del proyecto (cyan/ámbar).

### 1.2 Lógica NPC y "Typing Effect" (Modificar `frontend/app.js`)
- **Mecánica:** Al terminar el juego, pausar el `setTimeout(runTriage, 1400)`. Mostrar el modal de Hubzy.
- **Efecto de Texto:** Implementar una función `typeText(text, element)` que imprima el diálogo letra por letra.
- **Audio (Web Audio API):** Cada vez que se imprime una letra, reproducir un pitido muy corto y de tono aleatorio (estilo 8-bits / Loco Dave) para simular que Hubzy "habla".
- **Flujo de Preguntas:** Crear un array de 2 o 3 preguntas secuenciales (ej. *"¿Cómo se siente la nave hoy?"*).
- **Recolección:** Guardar las respuestas en `AppState.psych_answers`. Al terminar la última pregunta, ocultar modal y ahora sí disparar `runTriage()`.

### 1.3 Motor de Triaje y RAG (Modificar `backend/triage.py` y `backend/data/protocols.json`)
- **API Request:** Añadir a `AssessmentRequest` en `main.py` un campo `psych_answers: list[str] = []`.
- **Lógica (`triage.py`):** Crear nuevos dominios y códigos (ej. `PSYCH-ISOLATION`, `PSYCH-FATIGUE`). Mapear las respuestas del frontend a estos códigos de severidad (nominal, aviso, precaución).
- **Reglas de Fusión:** Crear un hallazgo compuesto si hay lentitud psicomotora (`PVT-LAPSES`) + mala respuesta psicológica = *"Posible fatiga mental severa o burnout"*.
- **RAG (`protocols.json`):** Añadir protocolos de la NASA sobre salud conductual, aislamiento y estrés para que el orquestador genere contramedidas relevantes.

---

## FASE 2: Fast-Triage Inicial (Síntomas Rápidos)
**Objetivo:** Permitir al usuario reportar síntomas físicos antes de que empiece la carga cognitiva.

- **Modificar `frontend/index.html`:** En el paso 1 (antes de pulsar JUGAR), añadir pequeños botones de íconos: 🤕 (Cefalea), 🤢 (Náusea), 😵‍💫 (Mareo), 👍 (Nominal).
- **Modificar `frontend/app.js`:** Capturar estos clics en una variable de estado y enviarlos dentro del campo `notes` del payload a `/api/assessment`.

---

## FASE 3: Micro-Intervención (Respiración 4-7-8)
**Objetivo:** Ofrecer una herramienta activa de calma si el veredicto es negativo.

- **Lógica en `app.js`:** En la función que renderiza el `VERDICT`, si el `triage_level` es `AMBER` o detecta `PSYCH-FATIGUE`, inyectar dinámicamente un botón "Iniciar Calibración 4-7-8".
- **Animación (CSS/JS):** Al hacer clic, mostrar un círculo central que se expanda en 4 segundos (Inhalar), se mantenga 7 segundos (Sostener) y se reduzca en 8 segundos (Exhalar).

---

## FASE 4: Modo Jurado (Orquestación de Demos)
**Objetivo:** Simulaciones perfectas para Space Apps sin tener que falsear biometría en vivo.

- **Modificar `frontend/app.js`:** Crear un *listener* global de teclado.
  - `Alt + Shift + 1`: Inyecta métricas perfectas (NOMINAL).
  - `Alt + Shift + 2`: Inyecta métricas degradadas + respuestas de estrés (ÁMBAR).
  - `Alt + Shift + 3`: Inyecta asimetría facial severa (ROJO).
- **Acción:** Estas combinaciones deben poblar `AppState`, saltar el juego y la cámara, e ir directamente a renderizar el Veredicto consultando al backend.

---

## INSTRUCCIONES DE EJECUCIÓN PARA EL IDE:
1. Empieza estrictamente por la **FASE 1**.
2. No sobrescribas la funcionalidad del fallback local (`_MemoryStore` y `_template_card`).
3. Mantén el código modular. Crea funciones separadas en `app.js` para la UI de Hubzy (`showHubzyCheckin()`, `playBabbleSound()`).
4. Usa los colores del tema actual definidos en `style.css` (`--bg-color`, `--accent-cyan`, `--alert-amber`, etc.).
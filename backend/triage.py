"""
Motor de triaje por convergencia de señales — Hubzy Astro-Triage.

Traduce métricas crudas (cámara + micro-juego + vitales) en hallazgos con
severidad clínica según el algoritmo de convergencia IMG-CHECKLIST-9.1:
  VERDE  = 1 dominio leve   -> registrar y reevaluar
  ÁMBAR  = 2 dominios o >15% -> contramedidas activas
  ROJO   = 3 dominios / focalidad neurológica / >25% -> emergencia a bordo
"""

from dataclasses import dataclass, field


SEVERITY_ORDER = {"nominal": 0, "advisory": 1, "caution": 2, "warning": 3, "critical": 4}
SEVERITY_LABEL = {
    "nominal": "NOMINAL",
    "advisory": "AVISO",
    "caution": "PRECAUCIÓN",
    "warning": "ALERTA",
    "critical": "CRÍTICO",
}
SEVERITY_LABEL_EN = {
    "nominal": "NOMINAL",
    "advisory": "ADVISORY",
    "caution": "CAUTION",
    "warning": "WARNING",
    "critical": "CRITICAL",
}
SEVERITY_COLOR = {
    "nominal": "#22c55e",
    "advisory": "#84cc16",
    "caution": "#eab308",
    "warning": "#f97316",
    "critical": "#ef4444",
}


@dataclass
class Metrics:
    blink_rate: float | None = None          # parpadeos/min
    blink_delta_pct: float | None = None     # % vs basal (~15-20/min)
    blink_duration_ms: float | None = None   # duración media del parpadeo
    perclos: float | None = None             # % tiempo ojos >=78% cerrados (0-1)
    yawn_count: int | None = None            # bostezos en la sesión (MAR sostenido)
    facial_asymmetry: float | None = None    # índice 0-1
    ear_asymmetry: float | None = None       # diferencia EAR ojo izq vs der 0-1
    head_sway: float | None = None           # temblor frame-a-frame normalizado 0-1
    mean_latency_ms: float | None = None     # latencia media de respuesta
    latency_delta_pct: float | None = None   # % vs línea basal individual
    error_rate: float | None = None          # 0-1
    lapse_count: int | None = None           # respuestas >500 ms (estándar PVT)
    hr_bpm: float | None = None              # frecuencia cardiaca (manual/wearable)
    rppg_hr: float | None = None             # pulso estimado por cámara (rPPG)
    hrv_rmssd_ms: float | None = None        # variabilidad RMSSD desde rPPG (estrés)
    gaze_away_pct: float | None = None       # % tiempo mirando fuera de la tarea 0-1
    face_tension: float | None = None        # ceño/párpados tensos 0-1 (estrés, dolor)
    sclera_redness: float | None = None      # enrojecimiento de esclerótica 0-1
    hr_baseline_bpm: float | None = None
    notes: str = ""
    psych_answers: list[str] = field(default_factory=list)  # ["mood:bajo", ...] del check-in NPC
    lang: str = "es"                                       # idioma de salida: "es" | "en"


@dataclass
class Finding:
    code: str
    domain: str
    severity: str
    detail: str
    query_terms: list[str] = field(default_factory=list)


# Traducción a lenguaje de astronauta: texto claro + paso accionable
PLAIN = {
    "EYE-FATIGUE": {
        "plain": "Parpadeas mucho menos de lo normal — tus ojos muestran cansancio.",
        "step": "Descansa la vista: cada 20 min mira lejos 20 segundos y parpadea fuerte. Si sientes sequedad, lágrimas artificiales del kit.",
    },
    "NEURO-FACIAL": {
        "plain": "Hay una diferencia entre los dos lados de tu cara que antes no estaba.",
        "step": "DETÉN TODO. Examen FAST con otro tripulante (sonríe, levanta ambos brazos 10 s, repite una frase) y canal médico prioritario ahora.",
    },
    "VEST-INSTAB": {
        "plain": "Tu cabeza se movía más de lo normal — posible mareo o desequilibrio.",
        "step": "Mueve la cabeza despacio y fija la vista en un punto fijo antes de desplazarte. Hidrátate con electrolitos.",
    },
    "PSYCHOMOTOR-SLOW": {
        "plain": "Respondiste más lento que tu ritmo habitual.",
        "step": "Siesta de 20 min antes de tu próxima tarea. Nada de EVA, robótica ni acoplamiento hasta reevaluar.",
    },
    "PVT-LAPSES": {
        "plain": "Te distraíste varias veces — respuestas de más de medio segundo.",
        "step": "Señal de falta de sueño: bloquea tu próxima ventana de descanso de 8 h y evita cafeína en las 8 h previas.",
    },
    "COG-ERRORS": {
        "plain": "Fallaste más cartas de lo normal — tu precisión bajó.",
        "step": "Revisa la ventilación del módulo (el CO2 alto hace esto) y cuánto dormiste las últimas 24 h.",
    },
    "CV-TACHY": {
        "plain": "Tu pulso está por encima de lo normal para ti.",
        "step": "Toma 400-500 ml de agua con electrolitos ahora y vuelve a medir tu pulso en 45 min.",
    },
    "SLEEP-DROWSY": {
        "plain": "Bostezos y ojos medio cerrados — llevas mucho sueño acumulado.",
        "step": "Protege tu próxima ventana de sueño: 8 h bloqueadas, módulo oscuro y sin cafeína 8 h antes.",
    },
    "EYE-LID": {
        "plain": "Tus parpadeos son más largos de lo normal — los párpados pesan.",
        "step": "Igual que el cansancio de ojos: descansa la vista y prioriza tu próxima siesta.",
    },
    "ATT-GAZE": {
        "plain": "Mirabas fuera de la pantalla buena parte del tiempo — atención dividida.",
        "step": "Regla de enfoque: bloques de 25 min sin distracciones. Si es cansancio y no ruido del módulo, siesta corta.",
    },
    "FACE-TENSION": {
        "plain": "Tu cara muestra tensión — ceño fruncido y párpados cargados (estrés o dolor).",
        "step": "Pausa de regulación: respiración 4-7-8 durante 3 min. Si hay dolor localizado, regístralo y repórtalo.",
    },
    "CV-HRV": {
        "plain": "La variabilidad de tu pulso está baja — el cuerpo no se está recuperando del estrés.",
        "step": "Baja una marcha hoy: tareas ligeras, hidratación y prioriza la próxima ventana de sueño.",
    },
    "EYE-RED": {
        "plain": "Tus ojos se ven enrojecidos — irritación o fatiga ocular.",
        "step": "Lágrimas artificiales del kit y revisa que no te dé el aire del ventilador en la cara.",
    },
    "PSYCH-MOOD": {
        "plain": "Reportaste que la moral anda baja hoy.",
        "step": "Anota el motivo en tu diario de vuelo, haz 10 min de algo que disfrutes y busca contacto social con la tripulación antes de dormir.",
    },
    "PSYCH-FATIGUE": {
        "plain": "El sueño vino mal — descanso insuficiente según tu propio reporte.",
        "step": "Protege la próxima ventana de sueño: 8 h bloqueadas, módulo oscuro y sin pantallas 30 min antes.",
    },
    "PSYCH-ISOLATION": {
        "plain": "Te sientes aislado del equipo — esto importa tanto como lo físico.",
        "step": "Habla 15 min con alguien de la tripulación hoy. Si persiste una semana, abre canal de apoyo psicológico en el próximo enlace.",
    },
    "SYM-HEAD": {
        "plain": "Reportaste dolor de cabeza.",
        "step": "Hidrátate con 400 ml de agua y revisa el CO2 del módulo. Si es súbito e intenso ('el peor de tu vida'), avisa ya por canal médico.",
    },
    "SYM-DIZZY": {
        "plain": "Reportaste mareo.",
        "step": "Mueve la cabeza lento, fija la vista en un punto estable y toma electrolitos. Nada de EVA ni acoplamiento hoy.",
    },
    "SYM-NAUSEA": {
        "plain": "Reportaste náusea.",
        "step": "Comida ligera y frecuente, evita olores fuertes y movimientos bruscos de cabeza. Si hay vómito repetido, rehidrata con electrolitos.",
    },
}

# Versión en inglés de PLAIN — mismo esquema code -> {plain, step}
PLAIN_EN = {
    "EYE-FATIGUE": {
        "plain": "You're blinking far less than normal — your eyes show fatigue.",
        "step": "Rest your eyes: every 20 min look far away for 20 seconds and blink firmly. If dry, use the artificial tears in the kit.",
    },
    "NEURO-FACIAL": {
        "plain": "There's a difference between the two sides of your face that wasn't there before.",
        "step": "STOP EVERYTHING. FAST exam with another crew member (smile, raise both arms 10 s, repeat a sentence) and open the priority medical channel now.",
    },
    "VEST-INSTAB": {
        "plain": "Your head was moving more than usual — possible dizziness or imbalance.",
        "step": "Move your head slowly and fix your gaze on a stable point before moving. Hydrate with electrolytes.",
    },
    "PSYCHOMOTOR-SLOW": {
        "plain": "You responded slower than your usual pace.",
        "step": "Take a 20-min nap before your next task. No EVA, robotics or docking until re-evaluation.",
    },
    "PVT-LAPSES": {
        "plain": "You zoned out several times — responses over half a second.",
        "step": "Sleep-deprivation sign: protect your next 8 h rest window and avoid caffeine in the 8 h before it.",
    },
    "COG-ERRORS": {
        "plain": "You missed more cards than usual — your accuracy dropped.",
        "step": "Check the module ventilation (high CO2 does this) and how much you slept in the last 24 h.",
    },
    "CV-TACHY": {
        "plain": "Your pulse is above your normal range.",
        "step": "Drink 400-500 ml of water with electrolytes now and re-check your pulse in 45 min.",
    },
    "SLEEP-DROWSY": {
        "plain": "Yawns and half-closed eyes — you're carrying serious sleep debt.",
        "step": "Protect your next sleep window: 8 h blocked, dark module, no caffeine 8 h before.",
    },
    "EYE-LID": {
        "plain": "Your blinks are longer than normal — heavy eyelids.",
        "step": "Same as eye fatigue: rest your eyes and prioritize your next nap.",
    },
    "ATT-GAZE": {
        "plain": "You were looking away from the screen much of the time — divided attention.",
        "step": "Focus rule: 25-min distraction-free blocks. If it's fatigue and not module noise, take a short nap.",
    },
    "FACE-TENSION": {
        "plain": "Your face shows tension — furrowed brow and heavy eyelids (stress or pain).",
        "step": "Regulation pause: 4-7-8 breathing for 3 min. If there's localized pain, log it and report it.",
    },
    "CV-HRV": {
        "plain": "Your heart-rate variability is low — your body isn't recovering from stress.",
        "step": "Downshift today: light tasks, hydration, and prioritize the next sleep window.",
    },
    "EYE-RED": {
        "plain": "Your eyes look red — irritation or eye fatigue.",
        "step": "Use the artificial tears in the kit and check that the fan airflow isn't hitting your face.",
    },
    "PSYCH-MOOD": {
        "plain": "You reported low spirits today.",
        "step": "Note the reason in your flight journal, do 10 min of something you enjoy, and seek crew contact before sleep.",
    },
    "PSYCH-FATIGUE": {
        "plain": "Sleep went badly — insufficient rest per your own report.",
        "step": "Protect the next sleep window: 8 h blocked, dark module, no screens 30 min before.",
    },
    "PSYCH-ISOLATION": {
        "plain": "You feel isolated from the crew — this matters as much as the physical.",
        "step": "Talk with a crew member for 15 min today. If it persists a week, open the psych-support channel on the next link.",
    },
    "SYM-HEAD": {
        "plain": "You reported a headache.",
        "step": "Hydrate with 400 ml of water and check module CO2. If it's sudden and severe ('worst of your life'), call the medical channel now.",
    },
    "SYM-DIZZY": {
        "plain": "You reported dizziness.",
        "step": "Move your head slowly, fix your gaze on a stable point and take electrolytes. No EVA or docking today.",
    },
    "SYM-NAUSEA": {
        "plain": "You reported nausea.",
        "step": "Light, frequent meals; avoid strong smells and sudden head movements. If vomiting repeats, rehydrate with electrolytes.",
    },
}


def _sev_ge(a: str, b: str) -> bool:
    return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b]


def evaluate(m: Metrics) -> dict:
    findings: list[Finding] = []
    lang = "en" if str(m.lang or "").lower().startswith("en") else "es"
    PL = PLAIN_EN if lang == "en" else PLAIN
    SL = SEVERITY_LABEL_EN if lang == "en" else SEVERITY_LABEL

    # --- Dominio ocular -----------------------------------------------------
    blink_slow = False
    if m.blink_rate is not None:
        basal = 17.0
        delta = m.blink_delta_pct if m.blink_delta_pct is not None else (
            (basal - m.blink_rate) / basal * 100
        )
        if m.blink_rate < 6 or delta > 60:
            sev = "warning"
        elif m.blink_rate < 8 or delta > 40:
            sev = "caution"
        elif m.blink_rate < 11 or delta > 25:
            sev = "advisory"
        else:
            sev = "nominal"
        blink_slow = _sev_ge(sev, "advisory")
        if blink_slow:
            findings.append(Finding(
                code="EYE-FATIGUE",
                domain="ocular",
                severity=sev,
                detail=f"Frecuencia de parpadeo {m.blink_rate:.0f}/min "
                       f"(-{delta:.0f}% vs basal ~17/min): fatiga visual y "
                       f"posible fatiga circadiana.",
                query_terms=["parpadeo", "fatiga visual", "ojos", "fatiga", "sueño"],
            ))

    # --- Somnolencia (PERCLOS + bostezos + parpadeos largos) ------------------
    drowsy = False
    drowsy_pts = 0
    if m.perclos is not None:
        if m.perclos > 0.25:
            drowsy_pts += 3
        elif m.perclos > 0.15:
            drowsy_pts += 2
        elif m.perclos > 0.08:
            drowsy_pts += 1
    if m.yawn_count is not None:
        drowsy_pts += min(3, m.yawn_count)
    if m.blink_duration_ms is not None and m.blink_duration_ms > 300:
        drowsy_pts += 1
    if drowsy_pts >= 1:
        sev = "warning" if drowsy_pts >= 4 else "caution" if drowsy_pts >= 3 else "advisory"
        drowsy = True
        parts = []
        if m.perclos is not None:
            parts.append(f"ojos cerrados {m.perclos*100:.0f}% del tiempo")
        if m.yawn_count:
            parts.append(f"{m.yawn_count} bostezo(s)")
        if m.blink_duration_ms and m.blink_duration_ms > 300:
            parts.append(f"parpadeos de {m.blink_duration_ms:.0f} ms")
        findings.append(Finding(
            code="SLEEP-DROWSY",
            domain="somnolencia",
            severity=sev,
            detail=f"Somnolencia objetiva: {', '.join(parts)}.",
            query_terms=["fatiga", "sueño", "somnolencia", "circadiano", "descanso"],
        ))
    if m.blink_duration_ms is not None and m.blink_duration_ms > 400:
        findings.append(Finding(
            code="EYE-LID",
            domain="ocular",
            severity="advisory",
            detail=f"Parpadeos largos ({m.blink_duration_ms:.0f} ms media): "
                   f"párpados pesados — correlato de presión de sueño.",
            query_terms=["parpadeo", "ojos", "fatiga visual", "sueño"],
        ))

    # --- Dominio neurológico (rostro + asimetría ocular L-R) ------------------
    neuro_focal = False
    neuro_score = m.facial_asymmetry if m.facial_asymmetry is not None else None
    if m.ear_asymmetry is not None:
        # Un ojo que cae distinto del otro refuerza la sospecha neuro
        ear_contrib = m.ear_asymmetry * 0.9
        neuro_score = max(neuro_score or 0, ear_contrib)
    if neuro_score is not None:
        if neuro_score > 0.28:
            sev, neuro_focal = "critical", True
        elif neuro_score > 0.18:
            sev = "warning"
        elif neuro_score > 0.12:
            sev = "advisory"
        else:
            sev = "nominal"
        if _sev_ge(sev, "advisory"):
            src = "ocular L-R" if (m.ear_asymmetry or 0) * 0.9 >= (m.facial_asymmetry or 0) else "facial"
            findings.append(Finding(
                code="NEURO-FACIAL",
                domain="neurologico",
                severity=sev,
                detail=f"Asimetría {src} {neuro_score:.2f} sobre umbral "
                       f"0.10: descartar evento neurológico — aplicar examen "
                       f"FAST (sonrisa, deriva de brazos, habla).",
                query_terms=["asimetria facial", "neurologico", "emergencia", "stroke"],
            ))

    # --- Dominio postural/vestibular ----------------------------------------
    postural = False
    if m.head_sway is not None:
        if m.head_sway > 0.6:
            sev = "warning"
        elif m.head_sway > 0.4:
            sev = "caution"
        elif m.head_sway > 0.25:
            sev = "advisory"
        else:
            sev = "nominal"
        postural = _sev_ge(sev, "advisory")
        if postural:
            findings.append(Finding(
                code="VEST-INSTAB",
                domain="vestibular",
                severity=sev,
                detail=f"Balanceo postural craneocervical {m.head_sway:.2f} "
                       f"(0-1): inestabilidad vestibular / posible intolerancia "
                       f"ortostática.",
                query_terms=["vestibular", "mareo", "postura", "equilibrio"],
            ))

    # --- Dominio psicomotor (juego de cartas) --------------------------------
    motor_slow = False
    if m.latency_delta_pct is not None:
        if m.latency_delta_pct > 25:
            sev = "warning"
        elif m.latency_delta_pct > 15:
            sev = "caution"
        elif m.latency_delta_pct > 10:
            sev = "advisory"
        else:
            sev = "nominal"
        motor_slow = _sev_ge(sev, "advisory")
        if motor_slow:
            lat_txt = f" ({m.mean_latency_ms:.0f} ms)" if m.mean_latency_ms is not None else ""
            findings.append(Finding(
                code="PSYCHOMOTOR-SLOW",
                domain="psicomotor",
                severity=sev,
                detail=f"Latencia de respuesta +{m.latency_delta_pct:.0f}% sobre "
                       f"línea basal{lat_txt}: enlentecimiento "
                       f"psicomotor — estándar PVT lo clasifica como fatiga "
                       f"{'significativa' if m.latency_delta_pct > 15 else 'moderada'}.",
                query_terms=["latencia", "psicomotriz", "vigilancia", "fatiga", "cognicion"],
            ))

    if m.lapse_count is not None and m.lapse_count >= 4:
        findings.append(Finding(
            code="PVT-LAPSES",
            domain="psicomotor",
            severity="advisory" if m.lapse_count < 8 else "caution",
            detail=f"{m.lapse_count} lapsus de atención (>500 ms, criterio PVT).",
            query_terms=["vigilancia", "atencion", "sueño", "fatiga"],
        ))
        motor_slow = True

    # --- Dominio cognitivo (precisión) ---------------------------------------
    cog_err = False
    if m.error_rate is not None:
        if m.error_rate > 0.45:
            sev = "warning"
        elif m.error_rate > 0.30:
            sev = "caution"
        elif m.error_rate > 0.18:
            sev = "advisory"
        else:
            sev = "nominal"
        cog_err = _sev_ge(sev, "advisory")
        if cog_err:
            findings.append(Finding(
                code="COG-ERRORS",
                domain="cognitivo",
                severity=sev,
                detail=f"Tasa de error cognitivo {m.error_rate*100:.0f}%: "
                       f"precisión degradada en asociación/memoria de trabajo.",
                query_terms=["cognicion", "errores", "fatiga", "co2"],
            ))

    # --- Atención visual (mirada fuera de la tarea) ---------------------------
    if m.gaze_away_pct is not None:
        if m.gaze_away_pct > 0.55:
            sev = "caution"
        elif m.gaze_away_pct > 0.40:
            sev = "advisory"
        else:
            sev = "nominal"
        if _sev_ge(sev, "advisory"):
            findings.append(Finding(
                code="ATT-GAZE",
                domain="cognitivo",
                severity=sev,
                detail=f"Mirada fuera de la tarea {m.gaze_away_pct*100:.0f}% del tiempo.",
                query_terms=["atencion", "vigilancia", "cognicion", "fatiga"],
            ))

    # --- Tensión facial (estrés/dolor) ----------------------------------------
    if m.face_tension is not None:
        if m.face_tension > 0.60:
            sev = "caution"
        elif m.face_tension > 0.45:
            sev = "advisory"
        else:
            sev = "nominal"
        if _sev_ge(sev, "advisory"):
            findings.append(Finding(
                code="FACE-TENSION",
                domain="muscular",
                severity=sev,
                detail=f"Tensión facial {m.face_tension:.2f}: ceño fruncido/"
                       f"párpados cargados sostenidos.",
                query_terms=["estres", "dolor", "tension", "psicologia"],
            ))

    # --- Enrojecimiento ocular --------------------------------------------------
    if m.sclera_redness is not None:
        if m.sclera_redness > 0.50:
            sev = "caution"
        elif m.sclera_redness > 0.30:
            sev = "advisory"
        else:
            sev = "nominal"
        if _sev_ge(sev, "advisory"):
            findings.append(Finding(
                code="EYE-RED",
                domain="ocular",
                severity=sev,
                detail=f"Esclerótica enrojecida (índice {m.sclera_redness:.2f}).",
                query_terms=["ojos", "irritacion", "fatiga visual"],
            ))

    # --- HRV: variabilidad cardíaca (estrés/recuperación) -----------------------
    if m.hrv_rmssd_ms is not None and m.hrv_rmssd_ms < 25:
        findings.append(Finding(
            code="CV-HRV",
            domain="cardiovascular",
            severity="advisory",
            detail=f"Variabilidad cardíaca RMSSD {m.hrv_rmssd_ms:.0f} ms — baja "
                   f"(estrés sostenido o recuperación insuficiente).",
            query_terms=["estres", "recuperacion", "corazon", "fatiga"],
        ))

    # --- Dominio cardiovascular ----------------------------------------------
    # Pulso: manual/wearable tiene prioridad; rPPG de cámara como respaldo
    hr_val = m.hr_bpm if m.hr_bpm is not None else m.rppg_hr
    cv_flag = False
    hr_delta = None
    if hr_val is not None:
        basal_hr = m.hr_baseline_bpm or 68.0
        hr_delta = (hr_val - basal_hr) / basal_hr * 100
        if hr_delta > 25 or hr_val > 110:
            sev = "warning"
        elif hr_delta > 15 or hr_val > 95:
            sev = "caution"
        elif hr_delta > 10 or hr_val > 88:
            sev = "advisory"
        else:
            sev = "nominal"
        cv_flag = _sev_ge(sev, "advisory")
        if cv_flag:
            src = "cámara rPPG" if m.hr_bpm is None else "manual/wearable"
            findings.append(Finding(
                code="CV-TACHY",
                domain="cardiovascular",
                severity=sev,
                detail=f"Frecuencia cardiaca {hr_val:.0f} lpm [{src}] "
                       f"(+{hr_delta:.0f}% vs basal {basal_hr:.0f}): descartar "
                       f"deshidratación/desequilibrio de electrolitos.",
                query_terms=["taquicardia", "frecuencia cardiaca", "deshidratacion", "electrolitos"],
            ))

    # --- Síntomas reportados por el tripulante (fast-triage, campo notes) ----
    notes_l = (m.notes or "").lower()
    SYMPTOM_DEF = [
        ("cefalea", "SYM-HEAD", "somatico",
         "Cefalea reportada por el tripulante.",
         ["cefalea", "dolor de cabeza", "co2", "hidration"]),
        ("mareo", "SYM-DIZZY", "vestibular",
         "Mareo reportado por el tripulante.",
         ["mareo", "vestibular", "ortostatico", "equilibrio"]),
        ("náusea", "SYM-NAUSEA", "somatico",
         "Náusea reportada por el tripulante.",
         ["nausea", "vestibular", "alimentacion", "deshidratacion"]),
        ("nausea", "SYM-NAUSEA", "somatico",
         "Náusea reportada por el tripulante.",
         ["nausea", "vestibular", "alimentacion", "deshidratacion"]),
    ]
    reported = set()
    for kw, code, domain, detail, terms in SYMPTOM_DEF:
        if kw in notes_l and code not in reported:
            reported.add(code)
            findings.append(Finding(
                code=code, domain=domain, severity="advisory",
                detail=detail, query_terms=terms,
            ))

    # --- Salud mental (check-in con Hubzy) ----------------------------------
    psych_neg = False
    PSYCH_DEF = {
        "mood": ("PSYCH-MOOD", {
            "bajo": ("advisory", "Moral baja reportada en el check-in diario."),
            "malo": ("caution", "Moral muy baja reportada — coste manteniendo el ánimo."),
        }),
        "sleep": ("PSYCH-FATIGUE", {
            "regular": ("advisory", "Sueño fragmentado reportado — descanso incompleto."),
            "mal": ("caution", "Privación de sueño reportada — casi no durmió."),
        }),
        "social": ("PSYCH-ISOLATION", {
            "distante": ("advisory", "Distanciamiento social reportado del equipo."),
            "aislado": ("caution", "Aislamiento percibido — marcador de salud conductual."),
        }),
    }
    for ans in m.psych_answers or []:
        key, _, val = str(ans).partition(":")
        spec = PSYCH_DEF.get(key)
        if spec and val in spec[1]:
            code = spec[0]
            sev, detail = spec[1][val]
            psych_neg = True
            findings.append(Finding(
                code=code, domain="psicologico", severity=sev, detail=detail,
                query_terms=["psicologia", "salud mental", "aislamiento", "estres", "moral", "equipo"],
            ))

    # --- Fusión / triage level (algoritmo IMG-9.1) ---------------------------
    domains_altered = {
        f.domain for f in findings if _sev_ge(f.severity, "advisory")
    }
    max_sev = max(
        (SEVERITY_ORDER[f.severity] for f in findings), default=0
    )
    worst_pct = max(
        [m.latency_delta_pct or 0, m.blink_delta_pct or 0, hr_delta or 0]
    )

    domains_caution_plus = {
        f.domain for f in findings if _sev_ge(f.severity, "caution")
    }
    if (
        neuro_focal
        or len(domains_caution_plus) >= 3
        or worst_pct > 25
        or max_sev >= SEVERITY_ORDER["warning"]
    ):
        triage_level = "ROJO"
    elif len(domains_altered) >= 2 or worst_pct > 15 or max_sev >= SEVERITY_ORDER["caution"]:
        triage_level = "AMBAR"
    elif findings:
        triage_level = "VERDE"
    else:
        triage_level = "NOMINAL"

    # --- Convergencias nombradas (patrones compuestos reconocibles) ----------
    composites: list[str] = []
    if (blink_slow or drowsy) and motor_slow and cv_flag:
        composites.append(
            "Cansancio acumulado + posible deshidratación "
            "(ojos cansados + reflejos lentos + pulso alto)" if lang == "es" else
            "Built-up fatigue + possible dehydration "
            "(tired eyes + slow reflexes + high pulse)"
        )
    if motor_slow and cog_err:
        composites.append(
            "Mente más lenta y con más errores — revisar el aire del "
            "módulo (CO2) o tu descanso antes de tareas críticas" if lang == "es" else
            "Slower mind with more errors — check module air (CO2) "
            "or your rest before critical tasks"
        )
    if postural and (cv_flag or cog_err):
        composites.append(
            "Inestabilidad con efecto en tu cuerpo — riesgo de mareo o desmayo" if lang == "es" else
            "Instability affecting your body — risk of dizziness or fainting"
        )
    if motor_slow and psych_neg:
        composites.append(
            "Reflejos lentos + ánimo/descanso en bajo — posible fatiga mental severa o burnout" if lang == "es" else
            "Slow reflexes + low mood/rest — possible severe mental fatigue or burnout"
        )

    # --- Query de recuperación para el RAG -----------------------------------
    if findings:
        query_terms = []
        for f in sorted(findings, key=lambda x: -SEVERITY_ORDER[x.severity]):
            query_terms.extend(f.query_terms[:3])
        for c in composites:
            query_terms.extend(c.split()[:6])
        query = " ".join(dict.fromkeys(query_terms))
    else:
        query = "evaluacion cognitiva pasiva monitoreo salud nominal"

    return {
        "triage_level": triage_level,
        "domains_altered": sorted(domains_altered),
        "findings": [
            {
                "code": f.code,
                "domain": f.domain,
                "severity": f.severity,
                "severity_label": SL[f.severity],
                "color": SEVERITY_COLOR[f.severity],
                "detail": f.detail,
                "plain": PL.get(f.code, {}).get("plain", f.detail),
                "step": PL.get(f.code, {}).get("step", ""),
            }
            for f in sorted(findings, key=lambda x: -SEVERITY_ORDER[x.severity])
        ],
        "composites": composites,
        "rag_query": query,
        "hr_delta_pct": round(hr_delta, 1) if hr_delta is not None else None,
    }

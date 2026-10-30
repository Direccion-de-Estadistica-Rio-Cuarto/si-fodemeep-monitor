/**
 * Motor de cálculo del Índice de Estado de Infraestructura Escolar (IES, 0–100).
 * Fuente: «Metodología y Motor de Cálculo del Índice IES (0–100) — FoDeMEEP Río Cuarto».
 *
 * Etapa 1. Detección de incidencias, normalizaciones y excepción hidráulica.
 * Etapa 2. Regla de completitud por dimensión (una dimensión incompleta vale 0).
 * Etapa 3. Cálculo de los 7 subíndices (0–100) con pisos mínimos y descuentos por rubro.
 * Etapa 4. Puntaje base ponderado y multiplicador compuesto de Kill-Switches.
 * Etapa 5. Clasificación final con bloqueo por Kill-Switch (override de seguridad).
 */
import {
  SECCIONES, DIMENSIONES, PARAMETROS_IES, PREGUNTAS, PREGUNTAS_OPCIONALES,
  preguntaVisible, normalizarRespuestas, esNoAplica, VALOR_NA
} from './catalogo.js';

const vacia = v => v == null || v === '' || (Array.isArray(v) && v.length === 0);
const acotar = (min, max, x) => Math.max(min, Math.min(max, x));
const banda = (valor, bandas) => bandas.find(b => valor >= b.min);

/** Rubros que descuentan en cada dimensión (acoplamiento transversal por tipo de incidencia). */
const RUBROS = {
  D1: ['GAS', 'ELECTRICIDAD', 'MATAFUEGOS'],
  D2: ['PLOMERIA', 'BOMBA', 'LIMPIEZA DE TANQUE/CISTERNA', 'DESAGOTE', 'LIMPIEZA DE DESAGUES'],
  D3: ['FILTRACIONES', 'ALBAÑILERIA', 'HERRERIA', 'PINTURA', 'OBRA'],
  D4: ['REPARACION/MANTENIMIENTO DE ARTEFACTOS', 'ADQUISICION DE ARTEFACTOS DE CLIMATIZACION'],
  D7: ['PODA/CORTE DE PASTO']
};

/** Etapa 1 — excepción hidráulica: edificio sin cisterna ni bombeo (subida directa de red). */
function sinCisternaNiBombeo(r) {
  return !vacia(r[88]) && Number(r[88]) === 0 && ['b_0', 'no_aplica'].includes(r[91]) && vacia(r[93]);
}

/** Etapa 2 — satisfacción automática de preguntas condicionales. */
function autoSatisfecha(id, r) {
  if (id === 93) return ['b_0', 'no_aplica'].includes(r[91]);
  if (id === 89) return !vacia(r[90]); // tanque oculto en entretecho: basta con #90
  return false;
}

export function calcularIES(respuestasOriginales = {}) {
  const r = normalizarRespuestas(respuestasOriginales);
  const excepcionHidraulica = sinCisternaNiBombeo(r);

  /* ---------- Etapa 1: incidencias ---------- */
  const incidencias = [];
  const noAplica = []; // respuestas «No aplica / No posee» (para control de justificación)
  let respondidas = 0, aplicables = 0;
  for (const s of SECCIONES) {
    for (const p of s.preguntas) {
      if (!preguntaVisible(p, r)) continue;
      aplicables++;
      const v = r[p.id];
      if (vacia(v)) continue;
      respondidas++;
      if (esNoAplica(p, v)) { noAplica.push({ idPregunta: p.id, seccion: s.n, pregunta: p.texto, critica: !!p.critica }); continue; }
      if (!p.opciones || p.tipo === 'multiple_choice') continue;
      const opcion = p.opciones.find(o => o.valor === v);
      const i = opcion?.incidencia;
      if (!i) continue;
      if (p.id === 91 && excepcionHidraulica) continue; // se omite: subida directa de red
      incidencias.push({
        idPregunta: p.id, seccion: s.n, pregunta: p.texto, respuesta: opcion.texto,
        tipo: i.tipo, criticidad: i.criticidad, jurisdiccion: i.jurisdiccion, puntos: i.puntos,
        descripcion: i.descripcion || opcion.rubrica || opcion.texto,
        killSwitch: !!i.killSwitch, motivoKillSwitch: i.killSwitch || ''
      });
    }
  }
  const killSwitches = incidencias.filter(i => i.killSwitch);

  /* ---------- Etapa 2: completitud por dimensión ---------- */
  const completitud = {};
  for (const d of DIMENSIONES) {
    let total = 0, resp = 0, cualTotal = 0, cualResp = 0;
    for (const s of SECCIONES.filter(x => d.secciones.includes(x.n))) {
      for (const p of s.preguntas) {
        if (!preguntaVisible(p, r)) continue; // no aplica por lógica condicional
        const ok = !vacia(r[p.id]) || autoSatisfecha(p.id, r);
        total++; if (ok) resp++;
        if (!PREGUNTAS_OPCIONALES.has(p.id)) { cualTotal++; if (ok) cualResp++; }
      }
    }
    completitud[d.id] = { total, respondidas: resp, cualitativasTotal: cualTotal, cualitativasRespondidas: cualResp,
      completa: resp === total || cualResp === cualTotal };
  }

  /* ---------- Etapa 3: subíndices ---------- */
  const suma = tipos => incidencias.filter(i => tipos.includes(i.tipo)).reduce((a, i) => a + i.puntos, 0);
  const cuenta = filtro => incidencias.filter(filtro).length;
  const A = Number(r[66]) || 0, R = Number(r[69]) || 0;
  const ratioCalef = A + R > 0 ? A / (A + R) : 1.0;
  const nClima = cuenta(i => RUBROS.D4.includes(i.tipo));

  const formulas = {
    D1: () => Math.round(acotar(10, 100, 100 - 2.2 * suma(RUBROS.D1))),
    D2: () => Math.round(acotar(10, 100, 100 - 2.5 * suma(RUBROS.D2))),
    D3: () => Math.round(acotar(10, 100, 100 - 2.2 * suma(RUBROS.D3))),
    D4: () => Math.round(acotar(15, 100, 70 * ratioCalef + (30 - 5 * nClima))),
    D5: () => Math.round(acotar(20, 100, 100 - 15 * cuenta(i => i.seccion === 13))),
    D6: () => Math.round(acotar(20, 100, 100 - 20 * cuenta(i => i.seccion === 12))),
    D7: () => Math.round(acotar(20, 100, 100 - 18 * cuenta(i => RUBROS.D7.includes(i.tipo))))
  };

  const dimensiones = DIMENSIONES.map(d => {
    const c = completitud[d.id];
    const puntaje = c.completa ? formulas[d.id]() : 0; // una dimensión incompleta vale 0
    const estado = c.completa ? banda(puntaje, PARAMETROS_IES.bandasSubindice) : { etiqueta: 'Incompleta', clase: 'vacio' };
    return { id: d.id, clave: d.clave, nombre: d.nombre, peso: d.peso, piso: d.piso, puntaje,
      completa: c.completa, estado: estado.etiqueta, claseEstado: estado.clase,
      cualitativasRespondidas: c.cualitativasRespondidas, cualitativasTotal: c.cualitativasTotal,
      respondidas: c.respondidas, total: c.total };
  });

  /* ---------- Etapa 4: puntaje base y Kill-Switches ---------- */
  const iBase = dimensiones.reduce((a, d) => a + (d.peso / 100) * d.puntaje, 0);
  const factores = killSwitches.map(k => k.criticidad === 'CRITICA' ? PARAMETROS_IES.factorKillSwitch.CRITICA : PARAMETROS_IES.factorKillSwitch.OTRA);
  const multiplicador = factores.reduce((a, f) => a * f, 1);
  const ies = acotar(0, 100, Math.round(iBase * multiplicador));

  /* ---------- Etapa 5: clasificación ---------- */
  const clasificacion = killSwitches.length
    ? { etiqueta: 'Crítico', clase: 'roja', forzadaPorKillSwitch: true }
    : { ...banda(ies, PARAMETROS_IES.bandasIES), forzadaPorKillSwitch: false };

  const orden = { CRITICA: 0, ALTA: 1, MEDIA: 2, BAJA: 3 };
  incidencias.sort((a, b) => (b.killSwitch - a.killSwitch) || (orden[a.criticidad] - orden[b.criticidad]) || (b.puntos - a.puntos));
  const porJurisdiccion = incidencias.reduce((acc, i) => { acc[i.jurisdiccion] = (acc[i.jurisdiccion] || 0) + 1; return acc; }, {});

  return {
    ies, iesBase: Math.round(iBase * 10) / 10, multiplicador: Math.round(multiplicador * 10000) / 10000,
    clasificacion, dimensiones, dimensionesCompletas: dimensiones.filter(d => d.completa).length,
    incidencias, killSwitches, porJurisdiccion, excepcionHidraulica, noAplica,
    avance: { respondidas, aplicables, porcentaje: aplicables ? Math.round(100 * respondidas / aplicables) : 0 }
  };
}

/** Validaciones de consistencia (no bloqueantes) entre totales y subtotales. */
export function validarConsistencia(respuestas = {}) {
  const avisos = [];
  const num = id => (respuestas[id] === VALOR_NA ? '' : respuestas[id]); // «No aplica» no es un número
  respuestas = Object.fromEntries(Object.keys(respuestas).map(k => [k, num(k)]));
  for (const [id, p] of PREGUNTAS) {
    if (!p.maxDe) continue;
    if (!vacia(respuestas[id]) && !vacia(respuestas[p.maxDe]) && Number(respuestas[id]) > Number(respuestas[p.maxDe])) {
      avisos.push({ id, mensaje: `#${id} (${respuestas[id]}) supera el total informado en #${p.maxDe} (${respuestas[p.maxDe]}).` });
    }
  }
  const t67 = Number(respuestas[67] || 0) + Number(respuestas[68] || 0);
  const yaMarcado = avisos.some(a => a.id === 67 || a.id === 68);
  if (!yaMarcado && !vacia(respuestas[66]) && t67 > Number(respuestas[66])) {
    avisos.push({ id: 68, mensaje: `La suma de #67 y #68 (${t67}) supera el total de equipos de calefacción (#66).` });
  }
  return avisos;
}

/** Preguntas requeridas sin completar. */
export function faltantesRequeridas(respuestas = {}) {
  return [...PREGUNTAS.values()].filter(p => p.requerido && !String(respuestas[p.id] ?? '').trim());
}

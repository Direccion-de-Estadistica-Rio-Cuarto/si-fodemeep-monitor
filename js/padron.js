/**
 * Padrón de instituciones educativas (unidad de relevamiento: CUE base).
 *
 * Fuentes, en orden de prioridad:
 *   1. Copia descargada de la hoja «Instituciones» de la planilla central (IndexedDB),
 *      que además trae el estado de relevamiento informado por todos los auditores.
 *   2. Padrón inicial embebido en la aplicación (funciona desde la primera apertura, sin conexión).
 */
import { db } from './db.js';
import { PADRON_INICIAL, VERSION_PADRON_INICIAL } from './padron-inicial.js';
import { cargarBarrios, asignarBarrios, estaEnBarrio } from './barrios.js';

let _cache = null;

/** El barrio de cada escuela es el del polígono donde cae (js/barrios.js), venga de donde venga el padrón. */
async function conBarriosOficiales(padron) {
  const geo = await cargarBarrios();
  return geo ? { ...padron, instituciones: asignarBarrios(padron.instituciones, geo) } : padron;
}

export async function obtenerPadron() {
  if (_cache) return _cache;
  const guardado = await db.leerConfig('padron');
  _cache = await conBarriosOficiales(guardado?.instituciones?.length ? guardado : { version: VERSION_PADRON_INICIAL, origen: 'inicial', instituciones: PADRON_INICIAL });
  return _cache;
}

export async function buscarInstitucion(cue) {
  const p = await obtenerPadron();
  return p.instituciones.find(i => i.cue === String(cue)) || null;
}

/** Descarga el padrón con su estado desde Apps Script. Silencioso ante falta de conexión. */
export async function actualizarPadronDesdeServidor(config) {
  if (!config?.url || !navigator.onLine) return false;
  try {
    const resp = await fetch(`${config.url}?accion=padron&token=${encodeURIComponent(config.token || '')}`);
    const j = await resp.json();
    if (!j.ok || !Array.isArray(j.instituciones) || !j.instituciones.length) return false;
    const descargado = { version: j.version || new Date().toISOString(), origen: 'servidor', actualizado: new Date().toISOString(), instituciones: j.instituciones };
    await db.escribirConfig('padron', descargado);
    _cache = await conBarriosOficiales(descargado);
    return true;
  } catch { return false; }
}

const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function filtrar(instituciones, { texto = '', barrio = '', nivel = '', estado = '' } = {}, estados = new Map()) {
  const t = sinTildes(texto).trim();
  return instituciones.filter(i => {
    if (barrio && !estaEnBarrio(i.barrio, barrio)) return false;
    if (nivel && !i.niveles.includes(nivel)) return false;
    if (estado && estados.get(i.cue)?.clave !== estado) return false;
    if (!t) return true;
    const pajar = sinTildes([i.nombre, ...i.nombres, i.cue, ...i.cuesAsociados, i.barrio, ...i.direcciones].join(' '));
    return t.split(/\s+/).every(palabra => pajar.includes(palabra));
  });
}

/**
 * Estado de cada institución combinando lo cargado en este dispositivo con lo informado
 * por la planilla central. Devuelve Map<cue, { clave, etiqueta, ies, clase, idLocal }>.
 */
export function calcularEstados(instituciones, relevamientosLocales) {
  const porCue = new Map();
  for (const r of relevamientosLocales) {
    const cue = r.institucion?.cue; if (!cue) continue;
    (porCue.get(cue) || porCue.set(cue, []).get(cue)).push(r);
  }
  const estados = new Map();
  for (const i of instituciones) {
    const locales = (porCue.get(i.cue) || []).sort((a, b) => (b.actualizado || '').localeCompare(a.actualizado || ''));
    const borrador = locales.find(r => r.estado === 'borrador');
    const cerrado = locales.find(r => r.estado !== 'borrador');
    const srv = i.estadoServidor || {};
    let e;
    if (borrador) e = { clave: 'en_curso', etiqueta: 'En curso en este dispositivo', clase: 'curso', idLocal: borrador.id };
    else if (cerrado || srv.cantRelevamientos > 0) {
      const ies = cerrado?.resultado?.ies ?? srv.ultimoIes;
      const alerta = cerrado ? cerrado.resultado?.killSwitches?.length > 0 : srv.alertaRoja;
      e = { clave: 'relevada', etiqueta: alerta ? 'Relevada · Alerta Roja' : 'Relevada', clase: alerta ? 'alerta' : 'relevada', ies, idLocal: cerrado?.id };
    } else if (srv.estado === 'En curso') e = { clave: 'en_curso_otro', etiqueta: `En curso${srv.tecnico ? ` · ${srv.tecnico}` : ''}`, clase: 'curso' };
    else e = { clave: 'pendiente', etiqueta: 'Pendiente', clase: 'pendiente' };
    estados.set(i.cue, e);
  }
  return estados;
}

export const textoBarrio = b => b || 'Sin barrio asignado';
export const resumenInstitucion = i => `${i.nombre} - CUE: ${i.cue}`;

/**
 * Datos de ejemplo del Monitor Ejecutivo.
 *
 * Genera relevamientos simulados sobre el padrón real, calculados con el mismo catálogo
 * y el mismo motor del IES que usa la PWA. Tienen la misma estructura que las hojas de la
 * planilla central, para que el Monitor use un único camino de datos.
 * NO corresponden a relevamientos reales: sólo sirven para demostración y capacitación.
 */
import { PREGUNTAS } from '../js/catalogo.js';
import { calcularIES } from '../js/motor-ies.js';
import { PADRON_INICIAL } from '../js/padron-inicial.js';

/** Generador pseudoaleatorio con semilla (resultados estables entre recargas). */
function azar(semilla) {
  let a = semilla >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const TECNICOS = ['Arq. Laura Benítez', 'Ing. Martín Ferreyra', 'MMO Carlos Ortiz', 'Arq. Sofía Paredes'];
const OBSERVACIONES = ['Se observa en el ala norte, aulas 2 y 3.', 'El personal indica que el problema se repite con cada lluvia.',
  'Relevado con el portero; falta acceso a la terraza.', 'Ya hubo un reclamo anterior sin respuesta.', 'Afecta al sector del comedor.'];
const ESTADOS_GESTION = ['Pendiente', 'Pendiente', 'Pendiente', 'Programada', 'En ejecución', 'Resuelta', 'Derivada a Provincia'];

function respuestasSimuladas(rnd, calidad) {
  const r = {};
  for (const p of PREGUNTAS.values()) {
    if (p.id === 1 || p.id === 3 || p.id === 4) continue;
    if (p.tipo === 'text') continue;
    if (p.tipo === 'number') { r[p.id] = Math.round(rnd() * (p.maxDe ? 6 : 14)); continue; }
    if (p.tipo === 'multiple_choice') { r[p.id] = p.opciones.filter(() => rnd() < 0.5).map(o => o.valor); continue; }
    const opciones = p.opciones.filter(o => !o.noAplica);
    if (p.tipo === 'rating_5') {
      // Calidad alta → niveles 5/4; calidad baja → 3/2/1.
      const x = Math.min(0.999, Math.max(0, (1 - calidad) * 0.9 + (rnd() - 0.5) * 0.6));
      const nivel = 5 - Math.floor(x * 5);
      r[p.id] = String(Math.max(1, Math.min(5, nivel)));
      continue;
    }
    const sinInc = opciones.filter(o => !o.incidencia);
    const conInc = opciones.filter(o => o.incidencia && !o.incidencia.killSwitch);
    const ks = opciones.filter(o => o.incidencia?.killSwitch);
    const u = rnd();
    if (ks.length && u < (1 - calidad) * 0.07) r[p.id] = ks[0].valor;
    else if (conInc.length && u < (1 - calidad) * 0.55) r[p.id] = conInc[Math.floor(rnd() * conInc.length)].valor;
    else r[p.id] = (sinInc[0] || opciones[0]).valor;
  }
  r[42] = 'natural'; r[91] = 'b_2'; r[88] = 1;
  r[66] = 4 + Math.round(rnd() * 8); r[69] = Math.round((1 - calidad) * 5 * rnd());
  return r;
}

function fechaDDMM(d) { return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }

export function generarDatosEjemplo() {
  const rnd = azar(20261028);
  const hoy = new Date();
  const relevamientos = [], incidencias = [], instituciones = [];

  for (const inst of PADRON_INICIAL) {
    const u = rnd();
    const estadoServidor = { estado: 'Pendiente', cantRelevamientos: 0, ultimoIes: null, alertaRoja: false, tecnico: '' };
    const calidadBase = 0.25 + rnd() * 0.75;
    const cantidad = u < 0.62 ? (rnd() < 0.18 ? 2 : 1) : 0;
    if (!cantidad && u < 0.72) { estadoServidor.estado = 'En curso'; estadoServidor.tecnico = TECNICOS[Math.floor(rnd() * TECNICOS.length)]; }

    for (let k = 0; k < cantidad; k++) {
      const antiguedad = k === cantidad - 1 ? Math.floor(rnd() * 50) : 200 + Math.floor(rnd() * 120); // el último es reciente
      const fecha = new Date(hoy.getTime() - antiguedad * 864e5);
      const calidad = Math.min(1, calidadBase + (k === cantidad - 1 && cantidad > 1 ? 0.15 : 0)); // mejora tras intervenciones
      const resp = respuestasSimuladas(rnd, calidad);
      const res = calcularIES(resp);
      const id = `EJ-${inst.cue}-${k + 1}`;
      const tecnico = TECNICOS[Math.floor(rnd() * TECNICOS.length)];
      const dims = Object.fromEntries(res.dimensiones.map(d => [d.id, d.completa ? d.puntaje : 'Incompleta']));
      relevamientos.push({
        id_relevamiento: id, cue_base: inst.cue, establecimiento: inst.nombre, sede_relevada: inst.direcciones[0] || '', barrio: inst.barrio,
        fecha_recepcion: fecha.toISOString(), fecha_finalizacion: fecha.toISOString(), tecnico, fecha_relevamiento: fechaDDMM(fecha),
        ies: res.ies, ies_base: res.iesBase, multiplicador_kill_switch: res.multiplicador, clasificacion: res.clasificacion.etiqueta,
        cant_kill_switch: res.killSwitches.length, motivos_kill_switch: res.killSwitches.map(x => `#${x.idPregunta} ${x.motivoKillSwitch}`).join(' | '),
        cant_incidencias: res.incidencias.length,
        incid_fodemeep: res.incidencias.filter(i => i.jurisdiccion === 'FoDeMEEP').length,
        incid_provincia: res.incidencias.filter(i => i.jurisdiccion === 'PROVINCIA_MAYOR').length,
        avance_pct: res.avance.porcentaje, dimensiones_completas: res.dimensionesCompletas,
        D1_seguridad_critica: dims.D1, D2_agua_saneamiento: dims.D2, D3_estructura_cubiertas: dims.D3, D4_climatizacion: dims.D4,
        D5_alimentacion_cocina: dims.D5, D6_accesibilidad: dims.D6, D7_entorno_exterior: dims.D7, version_catalogo: 'ejemplo'
      });
      for (const i of res.incidencias) {
        const estado = k < cantidad - 1 ? 'Resuelta' : ESTADOS_GESTION[Math.floor(rnd() * ESTADOS_GESTION.length)];
        incidencias.push({
          id_relevamiento: id, cue_base: inst.cue, establecimiento: inst.nombre, barrio: inst.barrio, fecha_relevamiento: fechaDDMM(fecha),
          id_pregunta: i.idPregunta, seccion: i.seccion, tipo_incidencia: i.tipo, criticidad: i.criticidad, jurisdiccion: i.jurisdiccion,
          puntos: i.puntos, kill_switch: i.killSwitch ? 'SI' : 'NO', descripcion: i.killSwitch ? i.motivoKillSwitch : i.descripcion,
          pregunta: i.pregunta, respuesta: i.respuesta, estado_gestion: estado, observacion_gestion: '', fecha_gestion: '',
          observacion_auditor: rnd() < 0.2 ? OBSERVACIONES[Math.floor(rnd() * OBSERVACIONES.length)] : ''
        });
      }
      if (k === cantidad - 1) Object.assign(estadoServidor, {
        estado: 'Relevada', cantRelevamientos: cantidad, ultimoIes: res.ies,
        ultimaClasificacion: res.clasificacion.etiqueta, alertaRoja: res.killSwitches.length > 0
      });
    }
    instituciones.push({ ...inst, estadoServidor });
  }
  return { ok: true, ejemplo: true, generado: hoy.toISOString(), planilla: 'Datos de ejemplo', puedeEditar: true, instituciones, relevamientos, incidencias, evidencias: [] };
}

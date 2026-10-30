/**
 * Sincronización con la capa de datos (Google Sheets vía Apps Script Web App).
 *
 * Se envía con Content-Type text/plain para evitar la verificación previa CORS
 * (preflight), que Apps Script no admite. El servidor realiza un «upsert» por ID,
 * por lo que reenviar un relevamiento es seguro (operación idempotente).
 *
 * Operaciones:
 *   · iniciarRelevamiento  → marca la institución «En curso» en la hoja Instituciones.
 *   · guardarRelevamiento  → envía el relevamiento finalizado y actualiza el estado de la institución.
 *   · padron (GET)         → descarga el padrón con el estado informado por todos los auditores.
 */
import { db } from './db.js';
import { VERSION_CATALOGO, PREGUNTAS, VALOR_NA, TEXTO_NA } from './catalogo.js';
import { actualizarPadronDesdeServidor, buscarInstitucion } from './padron.js';

export async function obtenerConfig() {
  return (await db.leerConfig('servidor')) || { url: '', token: '', tecnico: '' };
}

async function enviar(config, cuerpo) {
  if (!config.url) throw new Error('No se configuró la URL del servicio de datos.');
  const resp = await fetch(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: config.token, ...cuerpo }),
    redirect: 'follow'
  });
  if (!resp.ok) throw new Error('Respuesta HTTP ' + resp.status);
  const json = await resp.json();
  if (!json.ok) throw new Error(json.error || 'El servidor rechazó el envío.');
  return json;
}

function armarPaquete(r) {
  return {
    accion: 'guardarRelevamiento',
    versionCatalogo: VERSION_CATALOGO,
    relevamiento: {
      id: r.id, creado: r.creado, actualizado: r.actualizado, finalizado: r.finalizado || '',
      dispositivo: navigator.userAgent.slice(0, 120),
      institucion: r.institucion ? { cue: r.institucion.cue, nombre: r.institucion.nombre, direccion: r.institucion.direccion, barrio: r.institucion.barrio } : null,
      // Una fila por pregunta respondida o con observación del auditor.
      respuestas: [...new Set([...Object.keys(r.respuestas || {}), ...Object.keys(r.observaciones || {})])]
        .map(Number).filter(id => PREGUNTAS.has(id)).sort((x, y) => x - y)
        .map(id => {
          const p = PREGUNTAS.get(id);
          const valor = r.respuestas?.[id] ?? '';
          const vals = Array.isArray(valor) ? valor : [valor];
          const texto = vals.map(v => v === VALOR_NA ? TEXTO_NA : (p.opciones?.find(o => o.valor === v)?.texto ?? v)).join(' | ');
          return { idPregunta: id, seccion: p.seccion, pregunta: p.texto, tipo: p.tipo,
            valor: Array.isArray(valor) ? valor.join('|') : valor, texto, observacion: r.observaciones?.[id] || '' };
        }),
      resultado: r.resultado
    }
  };
}

export async function sincronizarUno(r, config) {
  // Barrio vigente: el del polígono donde cae la escuela (también para relevamientos iniciados antes de la regla).
  const inst = r.institucion?.cue ? await buscarInstitucion(r.institucion.cue) : null;
  if (inst && r.institucion.barrio !== inst.barrio) { r.institucion.barrio = inst.barrio; await db.guardar(r); }
  const json = await enviar(config, armarPaquete(r));
  r.estado = 'sincronizado';
  r.sincronizado = new Date().toISOString();
  r.errorSync = '';
  r.avisoInicio = 'enviado';
  await db.guardar(r);
  return json;
}

async function avisarInicio(r, config) {
  await enviar(config, {
    accion: 'iniciarRelevamiento',
    relevamiento: { id: r.id, cue: r.institucion.cue, tecnico: r.respuestas?.[3] || '', fecha: r.respuestas?.[4] || '', creado: r.creado }
  });
  r.avisoInicio = 'enviado';
  await db.guardar(r);
}

/**
 * Envía los avisos de inicio y los relevamientos finalizados pendientes, y luego
 * actualiza el padrón local. Devuelve { enviados, errores }.
 */
export async function sincronizarPendientes() {
  const config = await obtenerConfig();
  const todos = await db.listar();
  const pendientes = todos.filter(r => r.estado === 'finalizado');
  let enviados = 0; const errores = [];
  if (!navigator.onLine) return { enviados, errores: pendientes.length ? ['Sin conexión: se reintentará automáticamente.'] : [] };
  if (!config.url) return { enviados, errores: pendientes.length ? ['Falta configurar la conexión con la planilla central (⚙ Configuración).'] : [] };

  for (const r of todos.filter(x => x.estado === 'borrador' && x.avisoInicio === 'pendiente' && x.institucion)) {
    try { await avisarInicio(r, config); } catch { /* se reintenta en la próxima sincronización */ }
  }
  for (const r of pendientes) {
    try { await sincronizarUno(r, config); enviados++; }
    catch (e) { r.errorSync = e.message; await db.guardar(r); errores.push(`${nombreDe(r)}: ${e.message}`); }
  }
  await actualizarPadronDesdeServidor(config);
  return { enviados, errores };
}

export const nombreDe = r => (r.institucion?.nombre || r.respuestas?.[1] || 'Establecimiento sin nombre').toString();

/**
 * Editor de respuestas del Monitor Ejecutivo — SI FoDeMEEP Río Cuarto.
 *
 * Permite corregir las respuestas de un relevamiento ya enviado. Arma el formulario con el
 * mismo catálogo que la PWA (js/catalogo.js), recalcula el IES en vivo con el mismo motor
 * (js/motor-ies.js) y entrega un paquete con el formato de «guardarRelevamiento» más la lista
 * de cambios, el responsable y el motivo, para la auditoría (hoja «Ediciones»).
 * No sabe de dónde vienen ni a dónde van los datos: eso lo resuelve monitor.js.
 */
import { icono } from '../js/iconos.js';
import { SECCIONES, PREGUNTAS, VERSION_CATALOGO, VALOR_NA, TEXTO_NA, preguntaVisible } from '../js/catalogo.js';
import { calcularIES, validarConsistencia, faltantesRequeridas } from '../js/motor-ies.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vacia = v => v == null || v === '' || (Array.isArray(v) && v.length === 0);
const igual = (a, b) => JSON.stringify(vacia(a) ? '' : a) === JSON.stringify(vacia(b) ? '' : b);

/* ================= Conversión hoja ↔ formulario ================= */

/** Valor guardado en la hoja «Respuestas» → valor del formulario (la planilla puede devolver números y fechas). */
function valorDesdeHoja(p, v) {
  if (v == null || v === '') return '';
  if (v === VALOR_NA) return VALOR_NA;
  if (p.tipo === 'multiple_choice') return String(v).split('|').map(x => x.trim()).filter(Boolean);
  if (p.tipo === 'number') { const n = Number(v); return isNaN(n) ? '' : n; }
  if (p.formato === 'fecha' && /^\d{4}-\d{2}-\d{2}T/.test(String(v))) {
    const d = new Date(v);
    return isNaN(d) ? String(v) : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  return String(v);
}

/** Filas de la hoja «Respuestas» de un relevamiento → { respuestas, observaciones } como en la PWA. */
export function desdeFilas(filas) {
  const respuestas = {}, observaciones = {};
  for (const f of filas || []) {
    const id = Number(f.id_pregunta), p = PREGUNTAS.get(id);
    if (!p) continue;
    const v = valorDesdeHoja(p, f.valor);
    if (!vacia(v)) respuestas[id] = v;
    if (f.observacion) observaciones[id] = String(f.observacion);
  }
  return { respuestas, observaciones };
}

/** Texto legible de una respuesta (igual que js/sync.js). */
export function textoRespuesta(p, valor) {
  if (vacia(valor)) return '';
  const vals = Array.isArray(valor) ? valor : [valor];
  return vals.map(v => v === VALOR_NA ? TEXTO_NA : (p.opciones?.find(o => o.valor === v)?.texto ?? v)).join(' | ');
}

/** Respuestas → lista para Apps Script (mismo formato que armarPaquete de js/sync.js). */
function listaRespuestas(respuestas, observaciones) {
  return [...new Set([...Object.keys(respuestas), ...Object.keys(observaciones)])]
    .map(Number).filter(id => PREGUNTAS.has(id)).sort((x, y) => x - y)
    .map(id => {
      const p = PREGUNTAS.get(id), valor = respuestas[id] ?? '';
      return { idPregunta: id, seccion: p.seccion, pregunta: p.texto, tipo: p.tipo,
        valor: Array.isArray(valor) ? valor.join('|') : valor, texto: textoRespuesta(p, valor), observacion: observaciones[id] || '' };
    });
}

/**
 * Filas de las hojas Relevamientos, Incidencias y Respuestas a partir de un paquete editado,
 * igual que guardarRelevamiento_ en Apps Script. Sirve para actualizar la vista sin volver a leer
 * la planilla (vista de ejemplo). Conserva la gestión previa de cada incidencia.
 */
export function filasDesdePaquete(paq, relAnterior, incAnteriores = []) {
  const r = paq.relevamiento, res = r.resultado, inst = r.institucion;
  const val = id => r.respuestas.find(x => x.idPregunta === id)?.texto || '';
  const dims = Object.fromEntries(res.dimensiones.map(d => [d.id, d.completa ? d.puntaje : 'Incompleta']));
  const gestion = new Map(incAnteriores.map(x => [Number(x.id_pregunta), x]));
  const obs = new Map(r.respuestas.map(x => [x.idPregunta, x.observacion]));
  const relevamiento = {
    ...relAnterior, tecnico: val(3) || relAnterior.tecnico || '', fecha_relevamiento: val(4) || relAnterior.fecha_relevamiento,
    fecha_actualizacion: r.actualizado, ies: res.ies, ies_base: res.iesBase, multiplicador_kill_switch: res.multiplicador,
    clasificacion: res.clasificacion.etiqueta, cant_kill_switch: res.killSwitches.length,
    motivos_kill_switch: res.killSwitches.map(k => `#${k.idPregunta} ${k.motivoKillSwitch}`).join(' | '),
    cant_incidencias: res.incidencias.length,
    incid_fodemeep: res.incidencias.filter(i => i.jurisdiccion === 'FoDeMEEP').length,
    incid_provincia: res.incidencias.filter(i => i.jurisdiccion === 'PROVINCIA_MAYOR').length,
    avance_pct: res.avance.porcentaje, dimensiones_completas: res.dimensionesCompletas,
    D1_seguridad_critica: dims.D1, D2_agua_saneamiento: dims.D2, D3_estructura_cubiertas: dims.D3, D4_climatizacion: dims.D4,
    D5_alimentacion_cocina: dims.D5, D6_accesibilidad: dims.D6, D7_entorno_exterior: dims.D7, version_catalogo: paq.versionCatalogo
  };
  const incidencias = res.incidencias.map(i => {
    const g = gestion.get(i.idPregunta);
    return {
      id_relevamiento: r.id, cue_base: inst.cue, establecimiento: inst.nombre, barrio: inst.barrio, fecha_relevamiento: relevamiento.fecha_relevamiento,
      id_pregunta: i.idPregunta, seccion: i.seccion, tipo_incidencia: i.tipo, criticidad: i.criticidad, jurisdiccion: i.jurisdiccion,
      puntos: i.puntos, kill_switch: i.killSwitch ? 'SI' : 'NO', descripcion: i.killSwitch ? i.motivoKillSwitch : i.descripcion,
      pregunta: i.pregunta, respuesta: i.respuesta, estado_gestion: g?.estado_gestion || 'Pendiente',
      observacion_gestion: g?.observacion_gestion || '', fecha_gestion: g?.fecha_gestion || '', observacion_auditor: obs.get(i.idPregunta) || ''
    };
  });
  const respuestas = r.respuestas.map(x => ({ id_relevamiento: r.id, cue_base: inst.cue, id_pregunta: x.idPregunta, seccion: x.seccion,
    tipo: x.tipo, pregunta: x.pregunta, valor: x.valor, texto_respuesta: x.texto, observacion: x.observacion }));
  return { relevamiento, incidencias, respuestas };
}

/* ================= Formulario ================= */

function campo(p, v) {
  const nombre = `ed-${p.id}`;
  const na = v === VALOR_NA;
  if (p.tipo === 'multiple_choice') {
    const sel = Array.isArray(v) ? v : [];
    return `<fieldset class="ed-multi" aria-label="${esc(p.texto)}">${p.opciones.map(o =>
      `<label class="chk"><input type="checkbox" name="${nombre}" value="${esc(o.valor)}" ${sel.includes(o.valor) ? 'checked' : ''}> ${esc(o.texto)}</label>`).join('')}</fieldset>`;
  }
  if (p.opciones) {
    return `<select id="${nombre}" data-campo="${p.id}"><option value="">Sin responder</option>${p.opciones.map(o =>
      `<option value="${esc(o.valor)}" ${o.valor === v ? 'selected' : ''}>${esc(o.texto)}${o.rubrica ? ` — ${esc(o.rubrica)}` : ''}</option>`).join('')}</select>`;
  }
  const entrada = p.tipo === 'number'
    ? `<input id="${nombre}" data-campo="${p.id}" type="number" min="0" step="1" inputmode="numeric" value="${na ? '' : esc(v)}" ${na ? 'disabled' : ''}>`
    : p.multilinea
      ? `<textarea id="${nombre}" data-campo="${p.id}" rows="3" ${na ? 'disabled' : ''}>${na ? '' : esc(v)}</textarea>`
      : `<input id="${nombre}" data-campo="${p.id}" type="text" value="${na ? '' : esc(v)}" placeholder="${esc(p.placeholder || '')}" ${na ? 'disabled' : ''}>`;
  return `<div class="ed-libre">${entrada}${p.admiteNA ? `<label class="chk"><input type="checkbox" data-na="${p.id}" ${na ? 'checked' : ''}> ${TEXTO_NA}</label>` : ''}</div>`;
}

function formulario(ed) {
  return SECCIONES.map(s => `<details class="ed-seccion" data-seccion="${s.n}" ${s.n === ed.abrir ? 'open' : ''}>
      <summary><span>${s.n}. ${esc(s.titulo)}</span><span class="ed-cambios-sec" data-cambios-sec="${s.n}"></span></summary>
      ${s.preguntas.map(p => `<div class="ed-preg" data-preg="${p.id}">
        <label class="ed-etq" for="ed-${p.id}"><small>#${p.id}</small> ${esc(p.texto)}${p.requerido ? ' <b class="ed-req" title="Obligatoria">*</b>' : ''}</label>
        <p class="ed-oculta-nota">No corresponde según otras respuestas: no se evalúa.</p>
        ${campo(p, ed.respuestas[p.id])}
        <input class="ed-obs" type="text" data-obs="${p.id}" value="${esc(ed.observaciones[p.id] || '')}" placeholder="Observación del auditor (opcional)" aria-label="Observación de la pregunta ${p.id}">
        <p class="ed-antes" data-antes="${p.id}"></p>
      </div>`).join('')}
    </details>`).join('');
}

/* ================= Estado y cálculo ================= */

function cambios(ed) {
  const ids = new Set([...Object.keys(ed.original.respuestas), ...Object.keys(ed.respuestas), ...Object.keys(ed.original.observaciones), ...Object.keys(ed.observaciones)].map(Number));
  return [...ids].filter(id => PREGUNTAS.has(id)).sort((a, b) => a - b).flatMap(id => {
    const p = PREGUNTAS.get(id);
    const a = ed.original.respuestas[id], n = ed.respuestas[id];
    const oa = ed.original.observaciones[id] || '', on = ed.observaciones[id] || '';
    if (igual(a, n) && oa === on) return [];
    return [{ idPregunta: id, seccion: p.seccion, pregunta: p.texto, anterior: textoRespuesta(p, a), nuevo: textoRespuesta(p, n), obsAnterior: oa, obsNueva: on }];
  });
}

function refrescar(ed) {
  const dlg = ed.dlg;
  const res = calcularIES(ed.respuestas);
  const lista = cambios(ed);
  const ks = res.killSwitches.length;
  const dif = res.ies - ed.iesAnterior;
  dlg.querySelector('#ed-resumen').innerHTML = `
    <div><span>IES actual</span><b>${ed.iesAnterior}</b><small>${esc(ed.clasifAnterior)}</small></div>
    <div class="ed-flecha" aria-hidden="true">${icono('ArrowRight')}</div>
    <div class="${lista.length ? 'ed-nuevo' : ''}"><span>IES con los cambios</span><b>${res.ies}</b><small>${esc(res.clasificacion.etiqueta)}${ks ? ` · ${ks} Kill-Switch` : ''}</small></div>
    <p>${lista.length ? `${lista.length} cambio${lista.length > 1 ? 's' : ''} · ${dif === 0 ? 'el IES no cambia' : `${dif > 0 ? '+' : ''}${dif} puntos`} · ${res.incidencias.length} incidencias` : 'Sin cambios todavía.'}</p>`;

  const porSec = {};
  for (const c of lista) porSec[c.seccion] = (porSec[c.seccion] || 0) + 1;
  dlg.querySelectorAll('[data-cambios-sec]').forEach(el => { const n = porSec[el.dataset.cambiosSec]; el.textContent = n ? `${n} cambio${n > 1 ? 's' : ''}` : ''; });
  const cambiadas = new Map(lista.map(c => [c.idPregunta, c]));
  dlg.querySelectorAll('[data-preg]').forEach(el => {
    const id = Number(el.dataset.preg), p = PREGUNTAS.get(id), c = cambiadas.get(id);
    el.classList.toggle('ed-cambiada', !!c);
    el.classList.toggle('ed-oculta', !preguntaVisible(p, ed.respuestas));
    el.querySelector('[data-antes]').textContent = c ? `Antes: ${c.anterior || 'sin responder'}${c.obsAnterior !== c.obsNueva ? ` · Observación: ${c.obsAnterior || '—'}` : ''}` : '';
  });

  const avisos = [
    ...faltantesRequeridas(ed.respuestas).map(p => `Falta completar #${p.id} «${p.texto}».`),
    ...validarConsistencia(ed.respuestas).map(a => a.mensaje)
  ];
  dlg.querySelector('#ed-avisos').innerHTML = avisos.map(a => `<li>${icono('TriangleAlert')} ${esc(a)}</li>`).join('');
  const listo = lista.length && !avisos.length && ed.responsable.trim() && ed.motivo.trim();
  dlg.querySelector('#ed-guardar').disabled = !listo || ed.guardando;
  ed.res = res; ed.lista = lista; ed.avisos = avisos;
}

function leerCampo(ed, el) {
  if (el.dataset.obs) { const id = Number(el.dataset.obs); const v = el.value.trim(); if (v) ed.observaciones[id] = el.value; else delete ed.observaciones[id]; return; }
  if (el.dataset.na) {
    const id = Number(el.dataset.na);
    const entrada = ed.dlg.querySelector(`[data-campo="${id}"]`);
    if (el.checked) { ed.respuestas[id] = VALOR_NA; entrada.value = ''; entrada.disabled = true; }
    else { delete ed.respuestas[id]; entrada.disabled = false; entrada.focus(); }
    return;
  }
  if (el.name?.startsWith('ed-') && el.type === 'checkbox') {
    const id = Number(el.name.slice(3));
    const marcadas = [...ed.dlg.querySelectorAll(`input[name="ed-${id}"]:checked`)].map(x => x.value);
    if (marcadas.length) ed.respuestas[id] = marcadas; else delete ed.respuestas[id];
    return;
  }
  if (el.dataset.campo) {
    const id = Number(el.dataset.campo), p = PREGUNTAS.get(id);
    const v = p.tipo === 'number' ? (el.value === '' ? '' : Math.max(0, Math.round(Number(el.value)))) : el.value;
    if (vacia(v)) delete ed.respuestas[id]; else ed.respuestas[id] = v;
    return;
  }
  if (el.id === 'ed-responsable') ed.responsable = el.value;
  if (el.id === 'ed-motivo') ed.motivo = el.value;
}

/* ================= Apertura ================= */

/**
 * Abre el editor.
 * @param {object} o
 * @param {object} o.rel        fila de la hoja Relevamientos (el relevamiento a corregir)
 * @param {object} o.escuela    institución del modelo del Monitor (cue, nombre, barrio)
 * @param {Array}  o.filas      filas de la hoja Respuestas de ese relevamiento
 * @param {number} [o.seccion]  sección que se abre desplegada
 * @param {string} [o.nota]     aviso que se muestra arriba del formulario
 * @param {(envio: object) => Promise<void>} o.guardar  recibe { paquete, cambios, responsable, motivo, iesAnterior }
 */
export function abrirEditor({ rel, escuela, filas, seccion, nota, guardar }) {
  const original = desdeFilas(filas);
  const ed = {
    original, respuestas: structuredClone(original.respuestas), observaciones: { ...original.observaciones },
    iesAnterior: Number(rel.ies), clasifAnterior: Number(rel.cant_kill_switch) ? 'Alerta Roja' : rel.clasificacion,
    responsable: '', motivo: '', guardando: false, abrir: seccion
  };
  let dlg = document.getElementById('editor-dialogo');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'editor-dialogo'; dlg.className = 'editor-dialogo'; document.body.appendChild(dlg); }
  ed.dlg = dlg;
  dlg.setAttribute('aria-labelledby', 'ed-titulo');
  dlg.innerHTML = `
    <header class="ed-cab">
      <div><small>CUE ${esc(escuela.cue)} · Relevamiento del ${esc(rel.fecha_relevamiento || '—')}</small><h2 id="ed-titulo">Editar respuestas — ${esc(escuela.nombre)}</h2></div>
      <button type="button" class="btn-ico" data-ed-cerrar aria-label="Cerrar sin guardar">${icono('X')}</button>
    </header>
    <section class="ed-resumen" id="ed-resumen" aria-live="polite"></section>
    <div class="ed-cuerpo">
      ${nota ? `<p class="ed-nota">${icono('Info')} ${esc(nota)}</p>` : ''}
      ${formulario(ed)}
    </div>
    <footer class="ed-pie">
      <ul class="ed-avisos" id="ed-avisos"></ul>
      <div class="ed-auditoria">
        <label><span>Responsable de la edición <b class="ed-req">*</b></span><input id="ed-responsable" type="text" autocomplete="name"></label>
        <label><span>Motivo de la corrección <b class="ed-req">*</b></span><textarea id="ed-motivo" rows="2" placeholder="Ej.: el técnico corrigió el estado del techo tras revisar las fotos."></textarea></label>
      </div>
      <p class="ed-legal">Se reemplaza el relevamiento con estas respuestas, se recalcula el IES y queda registrado en la hoja «Ediciones» (quién, cuándo, por qué y cada valor anterior). El seguimiento de gestión de las incidencias se conserva.</p>
      <div class="ed-botones">
        <button type="button" class="boton boton--secundario" data-ed-cerrar>Cancelar</button>
        <button type="button" class="boton boton--primario" id="ed-guardar" disabled>${icono('Save')} Guardar cambios</button>
      </div>
    </footer>`;

  const alCambiar = ev => { leerCampo(ed, ev.target); refrescar(ed); };
  dlg.oninput = alCambiar;
  dlg.onchange = alCambiar;
  dlg.oncancel = ev => { if (ed.guardando || (ed.lista?.length && !confirm('¿Cerrar sin guardar los cambios?'))) ev.preventDefault(); };
  dlg.onclick = async ev => {
    if (ev.target.closest('[data-ed-cerrar]')) {
      if (!ed.guardando && (!ed.lista?.length || confirm('¿Cerrar sin guardar los cambios?'))) dlg.close();
      return;
    }
    if (!ev.target.closest('#ed-guardar')) return;
    refrescar(ed);
    if (!ed.lista.length || ed.avisos.length) return;
    const ahora = new Date().toISOString();
    const paquete = {
      accion: 'guardarRelevamiento', versionCatalogo: VERSION_CATALOGO,
      relevamiento: {
        id: rel.id_relevamiento, creado: rel.fecha_creacion || '', actualizado: ahora, finalizado: rel.fecha_finalizacion || '',
        dispositivo: 'Monitor Ejecutivo (edición)',
        institucion: { cue: String(escuela.cue), nombre: rel.establecimiento || escuela.nombre, direccion: rel.sede_relevada || '', barrio: escuela.barrio || rel.barrio || '' },
        respuestas: listaRespuestas(ed.respuestas, ed.observaciones),
        resultado: ed.res
      }
    };
    const boton = dlg.querySelector('#ed-guardar');
    ed.guardando = true; boton.disabled = true; boton.innerHTML = `${icono('LoaderCircle')} Guardando…`;
    try {
      await guardar({ paquete, cambios: ed.lista, responsable: ed.responsable.trim(), motivo: ed.motivo.trim(), iesAnterior: ed.iesAnterior });
      ed.guardando = false;
      dlg.close();
    } catch (e) {
      ed.guardando = false;
      boton.innerHTML = `${icono('Save')} Guardar cambios`;
      refrescar(ed);
      dlg.querySelector('#ed-avisos').insertAdjacentHTML('afterbegin', `<li class="ed-error">${icono('TriangleAlert')} No se pudo guardar: ${esc(e.message || e)}</li>`);
    }
  };
  refrescar(ed);
  dlg.showModal();
  dlg.querySelector(`details[open] select, details[open] input`)?.focus();
}

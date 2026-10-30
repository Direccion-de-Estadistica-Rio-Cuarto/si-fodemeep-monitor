/**
 * Catálogo oficial de secciones y preguntas — PWA FoDeMEEP Río Cuarto.
 * Fuente: «Catálogo Completo de Secciones y Preguntas — PWA FoDeMEEP Río Cuarto».
 * 14 secciones · 73 preguntas operativas (IDs #1 a #166 del formulario técnico base).
 * Desde la versión 2026.10-v3 se excluyen #2 (director/a), #5 (teléfono) y #6 (correo institucional).
 * 11 disparadores de Kill-Switch (Alerta Roja Crítica).
 *
 * Toda modificación del instrumento debe realizarse en este archivo y
 * replicarse en la versión del catálogo (VERSION_CATALOGO).
 */

export const VERSION_CATALOGO = '2026.10-v4';

/** Jurisdicciones de intervención */
export const JURISDICCION = {
  FODEMEEP: 'FoDeMEEP',            // Mantenimiento municipal
  PROVINCIA_MAYOR: 'PROVINCIA_MAYOR' // Obra mayor a cargo de Provincia
};

/** Tipos de incidencia utilizados por el instrumento (subconjunto del catálogo oficial de 20). */
export const TIPOS_INCIDENCIA = [
  'MOBILIARIO', 'ALBAÑILERIA', 'OBRA', 'PINTURA', 'FILTRACIONES', 'HERRERIA', 'GAS',
  'LIMPIEZA DE DESAGUES', 'DESAGOTE', 'ADQUISICION DE ARTEFACTOS DE CLIMATIZACION',
  'LIMPIEZA DE TANQUE/CISTERNA', 'PLOMERIA', 'BOMBA', 'ELECTRICIDAD', 'MATAFUEGOS',
  'PODA/CORTE DE PASTO', 'REPARACION/MANTENIMIENTO DE ARTEFACTOS'
];

export const CRITICIDADES = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'];

/* ---------- Constructores auxiliares ---------- */

/** Incidencia: tipo, criticidad, jurisdicción ('F' = FoDeMEEP, 'P' = Provincia), puntos, descripción, kill-switch */
function inc(tipo, crit, jur, pts, desc = '', killSwitch = '') {
  return {
    tipo, criticidad: crit,
    jurisdiccion: jur === 'P' ? JURISDICCION.PROVINCIA_MAYOR : JURISDICCION.FODEMEEP,
    puntos: pts, descripcion: desc,
    killSwitch: killSwitch || null
  };
}
const op = (valor, texto, incidencia = null) => ({ valor, texto, incidencia });
const SI_NO = (incSi = null, incNo = null) => [op('si', 'Sí', incSi), op('no', 'No', incNo)];

const NIVELES = ['Excelente', 'Bueno', 'Regular', 'Malo', 'Crítico'];
/**
 * Escala rating_5 con rúbrica homologada.
 * r = [[descripción, incidencia|null] x 5] en orden Excelente → Crítico.
 */
function rubrica(r, noPosee = false) {
  const opciones = r.map(([desc, incidencia], i) => ({
    valor: String(5 - i), texto: NIVELES[i], rubrica: desc, incidencia: incidencia || null
  }));
  if (noPosee) opciones.push({ valor: 'no_posee', texto: 'No posee', rubrica: 'El establecimiento no cuenta con este equipamiento.', incidencia: null, noAplica: true });
  return opciones;
}

/* ---------- Dimensiones del IES (7 dimensiones ponderadas) ---------- */
/**
 * Fuente: «Metodología y Motor de Cálculo del Índice IES (0–100) — FoDeMEEP Río Cuarto».
 * Pesos (suman 100), secciones evaluadas y piso mínimo de cada subíndice.
 * El criterio de descuento de cada dimensión se implementa en js/motor-ies.js.
 */
export const DIMENSIONES = [
  { id: 'D1', clave: 'seguridadCritica', nombre: 'Seguridad Crítica e Instalaciones', peso: 25, secciones: [4, 9, 10], piso: 10,
    criterio: 'Incidencias GAS, ELECTRICIDAD y MATAFUEGOS: 100 − 2,2 × Σ puntos' },
  { id: 'D2', clave: 'aguaSaneamiento', nombre: 'Agua Potable y Saneamiento', peso: 20, secciones: [5, 7, 8], piso: 10,
    criterio: 'Incidencias PLOMERIA, BOMBA, LIMPIEZA DE TANQUE/CISTERNA, DESAGOTE y LIMPIEZA DE DESAGUES: 100 − 2,5 × Σ puntos' },
  { id: 'D3', clave: 'estructuraCubiertas', nombre: 'Estructura Edilicia y Cubiertas', peso: 18, secciones: [3], piso: 10,
    criterio: 'Incidencias FILTRACIONES, ALBAÑILERIA, HERRERIA, PINTURA y OBRA: 100 − 2,2 × Σ puntos' },
  { id: 'D4', clave: 'climatizacion', nombre: 'Climatización y Ventilación', peso: 15, secciones: [6], piso: 15,
    criterio: '70 × operatividad de calefacción (#66 / (#66 + #69)) + (30 − 5 × incidencias de artefactos)' },
  { id: 'D5', clave: 'alimentacionCocina', nombre: 'Alimentación y Cocina (PAICOR)', peso: 10, secciones: [13], piso: 20,
    criterio: '100 − 15 × artefactos con fallas en la Sección 13' },
  { id: 'D6', clave: 'accesibilidad', nombre: 'Accesibilidad Universal', peso: 7, secciones: [12], piso: 20,
    criterio: '100 − 20 × carencias en la Sección 12' },
  { id: 'D7', clave: 'entornoExterior', nombre: 'Entorno Exterior y Patios', peso: 5, secciones: [11], piso: 20,
    criterio: '100 − 18 × incidencias PODA/CORTE DE PASTO' }
];

/**
 * Preguntas estadísticas o de inventario: no son necesarias para dar por
 * completa una dimensión (regla de «completitud cualitativa»).
 */
export const PREGUNTAS_OPCIONALES = new Set([
  38, 42, 57, 66, 67, 68, 69, 80, 81, 82, 83, 87, 88, 98, 99, 101, 103, 104, 108, 112, 114, 115, 126, 141
]);

/** Parámetros del motor de cálculo. */
export const PARAMETROS_IES = {
  factorKillSwitch: { CRITICA: 0.75, OTRA: 0.85 }, // multiplicador compuesto sobre el índice global
  bandasIES: [                                      // clasificación final (sin Kill-Switch activo)
    { min: 85, etiqueta: 'Óptimo', clase: 'optimo' },
    { min: 70, etiqueta: 'Bueno', clase: 'bueno' },
    { min: 50, etiqueta: 'Regular', clase: 'regular' },
    { min: 0, etiqueta: 'Crítico', clase: 'critico' }
  ],
  bandasSubindice: [                                // estado de cada dimensión
    { min: 85, etiqueta: 'Excelente', clase: 'optimo' },
    { min: 70, etiqueta: 'Bueno', clase: 'bueno' },
    { min: 50, etiqueta: 'Regular', clase: 'regular' },
    { min: 30, etiqueta: 'Malo', clase: 'malo' },
    { min: 0, etiqueta: 'Crítico', clase: 'critico' }
  ]
};

/**
 * Normalización de valores históricos equivalentes (datos cargados con
 * versiones anteriores del instrumento).
 */
const EQUIVALENCIAS = {
  52: { adecuadas: 'adecuada' },
  136: { adecuada: 'si' },
  91: { '0': 'b_0', '1': 'b_1', '2': 'b_2', '3+': 'b_3', no_requiere: 'no_aplica' }
};
export function normalizarRespuestas(respuestas = {}) {
  const r = { ...respuestas };
  for (const [id, mapa] of Object.entries(EQUIVALENCIAS)) {
    if (r[id] != null && Object.prototype.hasOwnProperty.call(mapa, r[id])) r[id] = mapa[r[id]];
  }
  return r;
}

/* ---------- Secciones y preguntas ---------- */

export const SECCIONES = [
  {
    n: 1, titulo: 'Datos del Relevamiento y la Institución', icono: 'Building2',
    descripcion: 'Complete estos datos institucionales antes de iniciar el recorrido por el edificio.',
    preguntas: [
      { id: 1, texto: 'Nombre del Establecimiento / CUE', tipo: 'text', requerido: true, placeholder: 'Ej: Esc. Normal Superior Justo José de Urquiza - CUE: 1400123-00' },
      { id: 3, texto: 'Técnico/a responsable del relevamiento', tipo: 'text', requerido: true, placeholder: 'Ej: Arq. Técnico Municipal FoDeMEEP' },
      { id: 4, texto: 'Fecha del relevamiento', tipo: 'text', formato: 'fecha', placeholder: 'DD/MM/AAAA' }
    ]
  },
  {
    n: 2, titulo: 'Sobre el Establecimiento y Espacios', icono: 'LayoutGrid',
    descripcion: 'Información general sobre los espacios, turnos, matrícula y superficies.',
    preguntas: [
      { id: 7, texto: 'Cantidad total de espacios/ambientes del edificio', tipo: 'number', placeholder: 'Total de aulas, oficinas, baños, cocina, SUM, etc.' },
      { id: 8, texto: 'Cantidad total de aulas del edificio', tipo: 'number', placeholder: 'Total de aulas', maxDe: 7 },
      { id: 9, texto: '¿Todas las aulas se están utilizando actualmente?', tipo: 'single_choice', opciones: [
        op('si', 'Sí, todas en uso activo'),
        op('no', 'No, hay aulas clausuradas o en desuso', inc('MOBILIARIO', 'BAJA', 'F', 2, 'Aulas clausuradas o en desuso'))
      ] },
      { id: 10, texto: 'Cantidad de aulas en uso activo', tipo: 'number', maxDe: 8 },
      { id: 11, texto: 'Otros espacios existentes en la escuela', tipo: 'multiple_choice', opciones: [
        op('dir', 'Dirección'), op('vicedir', 'Vicedirección'), op('sec', 'Secretaría'), op('prof', 'Sala de Profesores'),
        op('coc', 'Cocina'), op('com', 'Comedor'), op('sum', 'Salón de Usos Múltiples - SUM'), op('bib', 'Biblioteca'),
        op('lab', 'Laboratorio'), op('comp', 'Sala de computación'), op('tal', 'Taller'), op('gim', 'Gimnasio / Cancha cubierta'),
        op('dep', 'Depósito / Pañol'), op('cald', 'Sala de máquinas / calderas')
      ] },
      { id: 15, texto: 'Antigüedad aproximada del edificio', tipo: 'single_choice', opciones: [
        op('lt10', 'Menos de 10 años'), op('10_30', '10 a 30 años'), op('30_50', '30 a 50 años'),
        op('gt50', 'Más de 50 años'), op('gt100', 'Más de 100 años (Patrimonial)')
      ] },
      { id: 16, texto: 'Superficie cubierta aproximada (m²)', tipo: 'number', placeholder: 'm² cubiertos' },
      { id: 18, texto: 'Matrícula aproximada de alumnos', tipo: 'number', placeholder: 'Total de alumnos' }
    ]
  },
  {
    n: 3, titulo: 'Estructura Edilicia — Pisos, Paredes y Techos', icono: 'Home',
    descripcion: 'Evaluación técnica del estado constructivo. Se incluye guía de homologación.',
    preguntas: [
      { id: 23, texto: 'Estado general de los pisos (aulas y espacios comunes)', tipo: 'rating_5', opciones: rubrica([
        ['Sin desniveles, piezas perfectamente adheridas, zócalos sanos.'],
        ['Desgaste superficial por tránsito normal, sin piezas sueltas ni tropiezos.'],
        ['Algunas baldosas fisuradas o despegadas, desgaste localizado sin peligro grave.', inc('ALBAÑILERIA', 'BAJA', 'F', 2)],
        ['Zonas extensas con baldosas faltantes o contrapiso expuesto.', inc('ALBAÑILERIA', 'MEDIA', 'F', 4)],
        ['Hundimientos o desniveles graves con peligro inminente de caídas.', inc('OBRA', 'ALTA', 'P', 7)]
      ]) },
      { id: 25, texto: '¿Se observan pisos rotos, con desniveles o riesgo de tropiezo/caída?', tipo: 'single_choice',
        opciones: SI_NO(inc('ALBAÑILERIA', 'ALTA', 'F', 4, 'Riesgo de tropiezo o desnivel peligroso en solado')) },
      { id: 27, texto: 'Estado general de paredes y muros (humedad, grietas, revoques)', tipo: 'rating_5', opciones: rubrica([
        ['Mampostería firme, pintura homogénea, sin humedad ni fisuras.'],
        ['Marcas de roce o suciedad leve sin daños en revoque.'],
        ['Pintura cuarteada, salitre o humedad superficial de condensación.', inc('PINTURA', 'BAJA', 'F', 2)],
        ['Humedad ascendente continua, revoque desprendiéndose o fisuras notorias.', inc('ALBAÑILERIA', 'MEDIA', 'F', 4)],
        ['Fisuras estructurales pasantes, desmoronamiento o peligro de colapso.', inc('OBRA', 'CRITICA', 'P', 8)]
      ]) },
      { id: 28, texto: '¿Se observan grietas estructurales o fisuras de consideración?', tipo: 'single_choice', critica: true,
        opciones: SI_NO(inc('OBRA', 'CRITICA', 'P', 8, 'Grietas estructurales pasantes', 'Grietas estructurales pasantes')) },
      { id: 30, texto: 'Estado general de techos y cubiertas', tipo: 'rating_5', opciones: rubrica([
        ['Estanqueidad absoluta, aislación térmica correcta, canaletas impecables.'],
        ['Sin filtraciones, mantenimiento de impermeabilización al día.'],
        ['Aislación envejecida, manchas secas pretéritas, sin goteras hoy.', inc('FILTRACIONES', 'BAJA', 'F', 3)],
        ['Filtraciones activas con lluvia, membranas desprendidas o chapas oxidadas.', inc('FILTRACIONES', 'ALTA', 'F', 6)],
        ['Entrada masiva de agua, colapso parcial de cubierta o riesgo de desprendimiento.', inc('OBRA', 'CRITICA', 'P', 10)]
      ]) },
      { id: 32, texto: '¿Existen filtraciones de agua de lluvia?', tipo: 'single_choice',
        opciones: SI_NO(inc('FILTRACIONES', 'ALTA', 'F', 5, 'Filtración activa de lluvia en sectores de la escuela')) },
      { id: 34, texto: '¿Se observa riesgo de desprendimiento de revoque, mampostería o material de cubierta?', tipo: 'single_choice', critica: true,
        opciones: SI_NO(inc('ALBAÑILERIA', 'CRITICA', 'F', 8, 'Riesgo inminente de desprendimiento de revoques/cielorraso', 'Riesgo inminente de desprendimiento de revoques/cielorraso')) },
      { id: 36, texto: 'Estado de aberturas (puertas y ventanas): marcos, cierres, vidrios', tipo: 'rating_5', opciones: rubrica([
        ['Aberturas escuadradas, vidrios de seguridad sanos, cerraduras suaves.'],
        ['Cierre correcto, vidrios completos, lubricación normal.'],
        ['Cerraduras duras, picaportes flojos o burletes faltantes.', inc('HERRERIA', 'BAJA', 'F', 2)],
        ['Hojas trabadas o desencajadas, vidrios partidos.', inc('HERRERIA', 'MEDIA', 'F', 4)],
        ['Hojas caídas, vidrios rotos con bordes cortantes expuestos.', inc('HERRERIA', 'ALTA', 'F', 6)]
      ]) },
      { id: 38, texto: 'Cantidad aproximada de vidrios rotos o faltantes', tipo: 'number', placeholder: 'Ej: 4' },
      { id: 39, texto: 'Estado de cerramientos perimetrales (rejas, muros, portones de acceso)', tipo: 'rating_5', opciones: rubrica([
        ['Cerco perimetral sólido, portones con pasadores seguros, pintura anticorrosiva.'],
        ['Sin aberturas vulnerables, estabilidad estructural adecuada.'],
        ['Pintura oxidada en tramos inferiores o portón pesado.', inc('HERRERIA', 'BAJA', 'F', 2)],
        ['Rejas dobladas, portón con riesgo de descarrilamiento o muro fisurado.', inc('HERRERIA', 'MEDIA', 'F', 4)],
        ['Huecos de libre acceso a la calle o portón caído con riesgo de aplastamiento.', inc('HERRERIA', 'ALTA', 'F', 6)]
      ]) }
    ]
  },
  {
    n: 4, titulo: 'Instalaciones de Gas', icono: 'Flame',
    descripcion: 'Relevamiento visual de seguridad en gas. Reporte inmediato ante indicios de riesgo.',
    preguntas: [
      { id: 42, texto: '¿La institución cuenta con instalación de gas?', tipo: 'single_choice', opciones: [
        op('natural', 'Sí, gas natural'), op('envasado', 'Sí, gas envasado (garrafa)'), op('ambas', 'Ambas'), op('no_posee', 'No posee')
      ] },
      { id: 43, texto: '¿La instalación cuenta con certificación/habilitación vigente?', tipo: 'single_choice', mostrarSi: { 42: ['natural', 'envasado', 'ambas'] }, opciones: [
        op('si', 'Sí, matriculado al día'),
        op('no', 'No / En trámite', inc('GAS', 'ALTA', 'F', 6, 'Instalación de gas sin habilitación vigente')),
        op('nsv', 'No se pudo verificar')
      ] },
      { id: 45, texto: 'Estado general visual de cañerías y conexiones de gas visibles', tipo: 'rating_5', mostrarSi: { 42: ['natural', 'envasado', 'ambas'] }, opciones: rubrica([
        ['Cañería epoxi amarilla impecable, engrapada firme cada metro, sin corrosión.'],
        ['Fijaciones firmes, sin corrosión, buen estado general.'],
        ['Pintura saltada superficialmente, sin deformaciones.', inc('GAS', 'MEDIA', 'F', 3)],
        ['Cañerías flojas, material no reglamentario o corrosión visible.', inc('GAS', 'ALTA', 'F', 6)],
        ['Conexiones precarias, caños doblados o riesgo inminente de fuga.', inc('GAS', 'CRITICA', 'F', 10, '', 'Riesgo grave en instalación de gas')]
      ]) },
      { id: 46, texto: '¿Se han detectado olores a gas o pérdidas reportadas en el último año?', tipo: 'single_choice', critica: true, mostrarSi: { 42: ['natural', 'envasado', 'ambas'] },
        opciones: SI_NO(inc('GAS', 'CRITICA', 'F', 12, 'Pérdida o fuga de gas reportada', 'Pérdida o fuga de gas reportada')) },
      { id: 51, texto: 'Llaves de paso: ¿cada artefacto tiene su llave propia, accesible y en buen estado?', tipo: 'single_choice', mostrarSi: { 42: ['natural', 'envasado', 'ambas'] }, opciones: [
        op('todos', 'Sí, todos con llave propia accesible y operativa'),
        op('algunos', 'Algunos no tienen o están trabadas', inc('GAS', 'MEDIA', 'F', 3)),
        op('mayoria', 'La mayoría carece de llave o está inaccesible', inc('GAS', 'ALTA', 'F', 6))
      ] },
      { id: 52, texto: 'Ventilación y evacuación de gases en locales con artefactos a gas', tipo: 'single_choice', critica: true, mostrarSi: { 42: ['natural', 'envasado', 'ambas'] }, opciones: [
        op('adecuada', 'Adecuadas en todos los locales (rejillas libres y tiro balanceado)'),
        op('deficientes', 'Deficientes u obstruidas en algunos locales', inc('GAS', 'ALTA', 'F', 5)),
        op('inexistentes', 'Inexistentes en locales con artefactos', inc('GAS', 'CRITICA', 'F', 9, '', 'Peligro de monóxido de carbono por falta de ventilación'))
      ] }
    ]
  },
  {
    n: 5, titulo: 'Cloacas y Desagües', icono: 'Droplets',
    descripcion: 'Estado del sistema de desagües cloacales y pluviales del establecimiento.',
    preguntas: [
      { id: 57, texto: 'Tipo de desagüe cloacal', tipo: 'single_choice', opciones: [
        op('red', 'Red cloacal pública'), op('camara', 'Cámara séptica / pozo absorbente'), op('otro', 'Otro')
      ] },
      { id: 58, texto: 'Estado general del sistema de desagüe cloacal', tipo: 'rating_5', opciones: rubrica([
        ['Evacuación instantánea, cámaras de inspección limpias, sin olores.'],
        ['Descarga normal sin desbordes.'],
        ['Descarga algo lenta en sanitarios de alta demanda.', inc('LIMPIEZA DE DESAGUES', 'BAJA', 'F', 2)],
        ['Desbordes ocasionales, olores frecuentes, requiere desagote.', inc('DESAGOTE', 'ALTA', 'F', 6)],
        ['Colapso total del pozo o red con desborde en patios o baños clausurados.', inc('OBRA', 'CRITICA', 'P', 8)]
      ]) },
      { id: 59, texto: '¿Se registran obstrucciones, malos olores o desbordes frecuentes?', tipo: 'single_choice',
        opciones: SI_NO(inc('DESAGOTE', 'ALTA', 'F', 5, 'Desbordes u olores cloacales en el edificio')) },
      { id: 60, texto: 'Estado de desagües pluviales y canaletas', tipo: 'rating_5', opciones: rubrica([
        ['Canaletas limpias de hojas, bajadas pluviales directas al cordón o pozo.'],
        ['Evacuación sin problemas en lluvias intensas.'],
        ['Acumulación menor de hojas o suciedad en rejillas.', inc('LIMPIEZA DE DESAGUES', 'BAJA', 'F', 2)],
        ['Canaletas desfondadas o desprendidas con caída de agua libre.', inc('LIMPIEZA DE DESAGUES', 'MEDIA', 'F', 4)],
        ['Anegamiento de aulas o patios por falta total de evacuación pluvial.', inc('OBRA', 'ALTA', 'P', 6)]
      ]) }
    ]
  },
  {
    n: 6, titulo: 'Climatización y Ventilación (Calefacción y Aire)', icono: 'Thermometer',
    descripcion: 'Padrón de estufas, calderas, radiadores y ventiladores.',
    preguntas: [
      { id: 66, texto: 'Cantidad TOTAL de equipos de calefacción en funcionamiento', tipo: 'number', placeholder: 'Equipos activos' },
      { id: 67, texto: 'De ese total: cantidad de calefactores a gas en funcionamiento', tipo: 'number', maxDe: 66 },
      { id: 68, texto: 'De ese total: cantidad de estufas / calefactores eléctricos en funcionamiento', tipo: 'number', maxDe: 66 },
      { id: 69, texto: 'Cantidad de equipos de calefacción fuera de servicio (a reparar o reemplazar)', tipo: 'number', placeholder: 'Equipos rotos' },
      { id: 70, texto: '¿Todas las aulas y espacios cuentan con calefacción adecuada?', tipo: 'single_choice', opciones: [
        op('si', 'Sí, la cobertura es completa'),
        op('no', 'No, faltan calefactores en algunas aulas/espacios', inc('ADQUISICION DE ARTEFACTOS DE CLIMATIZACION', 'ALTA', 'F', 5))
      ] },
      { id: 80, texto: 'Cantidad TOTAL de ventiladores (techo/pared) instalados', tipo: 'number' },
      { id: 81, texto: 'De ese total: cantidad de ventiladores en funcionamiento', tipo: 'number', maxDe: 80 },
      { id: 82, texto: 'Cantidad TOTAL de aires acondicionados instalados', tipo: 'number' },
      { id: 83, texto: 'De ese total: cantidad de aires acondicionados en funcionamiento', tipo: 'number', maxDe: 82 }
    ]
  },
  {
    n: 7, titulo: 'Sistema de Agua, Tanques y Bombas', icono: 'Waves',
    descripcion: 'Garantía de salubridad del agua potable y bombas en funcionamiento.',
    preguntas: [
      { id: 87, texto: 'Cantidad de tanques elevados / de reserva', tipo: 'number' },
      { id: 88, texto: 'Cantidad de cisternas (subterráneas o de piso)', tipo: 'number' },
      { id: 89, texto: 'Estado de conservación de tanques y cisternas', tipo: 'rating_5', opciones: rubrica([
        ['Tanque limpio, estructura firme, tapa hermética sellada, limpieza <6 meses.'],
        ['Sin filtraciones, estructura sana, tapa colocada.'],
        ['Requiere limpieza de rutina, accesorios con sarro.', inc('LIMPIEZA DE TANQUE/CISTERNA', 'MEDIA', 'F', 3)],
        ['Fisuras leves, tapa rota o desajustada con ingreso de polvo.', inc('LIMPIEZA DE TANQUE/CISTERNA', 'ALTA', 'F', 6)],
        ['Deterioro estructural grave de torre, riesgo de caída o agua contaminada.', inc('OBRA', 'CRITICA', 'P', 10, '', 'Riesgo hídrico y sanitario en tanques')]
      ]) },
      { id: 90, texto: '¿Todos los tanques/cisternas cuentan con tapa de cierre hermético?', tipo: 'single_choice', critica: true, opciones: [
        op('si', 'Sí, todas selladas y herméticas'),
        op('destapados', 'No, están destapados (riesgo sanitario inminente)', inc('PLOMERIA', 'CRITICA', 'F', 7, '', 'Tanques de agua potable sin tapa')),
        op('algunos', 'Algunos no cuentan con tapa adecuada', inc('PLOMERIA', 'ALTA', 'F', 4))
      ] },
      { id: 91, texto: 'Cantidad de bombas de agua en funcionamiento actualmente', tipo: 'single_choice', critica: true, opciones: [
        op('b_0', '0 (Sin bombas funcionando)', inc('BOMBA', 'CRITICA', 'F', 8, '', 'Falla total del sistema de bombeo de agua')),
        op('b_1', '1 bomba'), op('b_2', '2 bombas'), op('b_3', '3 o más bombas'),
        op('no_aplica', 'No requiere bomba (subida directa de red)')
      ] },
      { id: 93, texto: 'Estado general del sistema de bombeo', tipo: 'rating_5', mostrarSi: { 91: ['b_0', 'b_1', 'b_2', 'b_3'] }, opciones: rubrica([
        ['Automático funcionando, bombas alternadas, silenciosas, sin fugas.'],
        ['Bombeo eficiente sin calentamiento anormal.'],
        ['Ruidos mecánicos de rodamientos o automático manualizado.', inc('BOMBA', 'BAJA', 'F', 2)],
        ['Pérdida continua de agua por prensaestopas, recalentamiento.', inc('BOMBA', 'ALTA', 'F', 5)],
        ['Bomba quemada o trabada, imposibilidad de llenar tanques.', inc('BOMBA', 'CRITICA', 'F', 8)]
      ]) }
    ]
  },
  {
    n: 8, titulo: 'Sanitarios, Griferías y Mesadas', icono: 'Bath',
    descripcion: 'Padrón de inodoros, mochilas, canillas y pérdidas continuas.',
    preguntas: [
      { id: 98, texto: 'Cantidad TOTAL de inodoros o espacios destinados', tipo: 'number' },
      { id: 99, texto: 'De ese total: cantidad de inodoros en funcionamiento', tipo: 'number', maxDe: 98 },
      { id: 101, texto: 'Cantidad de mochilas/depósitos en estado REGULAR o MALO (pierden agua o rotos)', tipo: 'number', maxDe: 98 },
      { id: 103, texto: 'Cantidad TOTAL de mingitorios', tipo: 'number' },
      { id: 104, texto: 'De ese total: mingitorios en funcionamiento', tipo: 'number', maxDe: 103 },
      { id: 106, texto: 'Estado general de las canillas/griferías en todo el establecimiento', tipo: 'rating_5', opciones: rubrica([
        ['100% canillas estancas, volantes completos, corte instantáneo.'],
        ['Sin goteos visibles, griferías firmes.'],
        ['Goteos leves en 1 o 2 canillas secundarias.', inc('PLOMERIA', 'BAJA', 'F', 2)],
        ['Pérdidas continuas en múltiples canillas, volantes zafados o faltantes.', inc('PLOMERIA', 'MEDIA', 'F', 4)],
        ['Desperdicio masivo de agua por canillas rotas o faltantes arrancadas.', inc('PLOMERIA', 'ALTA', 'F', 6)]
      ]) },
      { id: 108, texto: 'Cantidad estimada de canillas que necesitan recambio urgente', tipo: 'number', placeholder: 'Ej: 8' }
    ]
  },
  {
    n: 9, titulo: 'Iluminación y Electricidad Interna', icono: 'Zap',
    descripcion: 'Seguridad en tableros, disyuntor diferencial, térmicas y luminarias.',
    preguntas: [
      { id: 112, texto: 'Tipo de iluminación predominante en aulas y pasillos', tipo: 'single_choice', opciones: [
        op('led_tubo', 'Tubos LED / Plafones LED'),
        op('fluor', 'Tubos fluorescentes antiguos (con arrancador/reactancia)'),
        op('lampara', 'Lámparas LED / Focos comunes')
      ] },
      { id: 113, texto: 'Estado de la iluminación interna', tipo: 'rating_5', opciones: rubrica([
        ['100% artefactos LED operativos, iluminación uniforme y sin zumbidos.'],
        ['Muy buena cobertura en aulas y pasillos.'],
        ['Focos quemados (<10%), iluminación algo tenue en rincones.', inc('ELECTRICIDAD', 'BAJA', 'F', 2)],
        ['Aulas a oscuras por tubos quemados, parpadeos molestos.', inc('ELECTRICIDAD', 'MEDIA', 'F', 4)],
        ['Instalación peligrosa con artefactos colgando de cables.', inc('ELECTRICIDAD', 'ALTA', 'F', 7)]
      ]) },
      { id: 114, texto: 'Cantidad aproximada TOTAL de artefactos de iluminación instalados', tipo: 'number' },
      { id: 115, texto: 'De ese total: cantidad aproximada de artefactos/tubos quemados a reemplazar', tipo: 'number', maxDe: 114 },
      { id: 116, texto: 'Estado de llaves de luz y tomacorrientes en aulas', tipo: 'rating_5', opciones: rubrica([
        ['Tapas firmes, módulos protegidos, tomacorrientes con obturador.'],
        ['En funcionamiento sin holguras.'],
        ['Tapas flojas o módulos gastados sin chispazos.', inc('ELECTRICIDAD', 'BAJA', 'F', 2)],
        ['Tomacorrientes rotos, sueltos o empotramientos cedidos.', inc('ELECTRICIDAD', 'MEDIA', 'F', 4)],
        ['Cables bajo tensión asomando o signos de fogonazo/chispas al alcance de niños.', inc('ELECTRICIDAD', 'CRITICA', 'F', 8, '', 'Peligro de electrocución en tomas')]
      ]) },
      { id: 117, texto: 'Estado general del tablero eléctrico principal', tipo: 'rating_5', opciones: rubrica([
        ['Gabinete metálico reglamentario cerrado con llave, contratapa cubrebornes, peines de distribución y rotulación.'],
        ['Térmicas normalizadas en orden, gabinete sano.'],
        ['Falta rotulación o desorden de cables sin bornes expuestos.', inc('ELECTRICIDAD', 'MEDIA', 'F', 3)],
        ['Gabinete sin puerta, sobrecalentamiento o térmicas puenteadas.', inc('ELECTRICIDAD', 'ALTA', 'F', 6)],
        ['Riesgo inminente: bornes vivos sin protección, óxido o quemaduras.', inc('ELECTRICIDAD', 'CRITICA', 'F', 10)]
      ]) },
      { id: 118, texto: '¿Posee disyuntor diferencial y llaves térmicas en funcionamiento?', tipo: 'single_choice', critica: true, opciones: [
        op('si', 'Sí, disyuntor probado con botón de test'),
        op('no', 'No posee disyuntor (peligro letal para las personas)', inc('ELECTRICIDAD', 'CRITICA', 'F', 12, '', 'Peligro letal: Tablero sin disyuntor diferencial'))
      ] },
      { id: 119, texto: '¿Se observan cables sueltos, empalmes expuestos o instalaciones improvisadas?', tipo: 'single_choice', critica: true,
        opciones: SI_NO(inc('ELECTRICIDAD', 'CRITICA', 'F', 10, '', 'Cables bajo tensión expuestos')) }
    ]
  },
  {
    n: 10, titulo: 'Seguridad, Matafuegos y Evacuación', icono: 'ShieldAlert',
    descripcion: 'Equipos contra incendio, salidas de emergencia y vías de evacuación.',
    preguntas: [
      { id: 126, texto: 'Cantidad total de matafuegos en la escuela', tipo: 'number' },
      { id: 127, texto: '¿Cuentan con la carga y oblea al día?', tipo: 'single_choice', opciones: [
        op('si', 'Sí, todas con carga y oblea vigente'),
        op('no', 'No, están vencidos', inc('MATAFUEGOS', 'ALTA', 'F', 6)),
        op('algunos', 'Algunos vencidos', inc('MATAFUEGOS', 'MEDIA', 'F', 3))
      ] },
      { id: 136, texto: '¿El edificio cuenta con salidas de emergencia?', tipo: 'single_choice', opciones: [
        op('si', 'Sí, señalizadas, libres y con barral antipánico'),
        op('deficiencias', 'Sí, pero con deficiencias (con candado, trabadas o sin señalizar)', inc('HERRERIA', 'ALTA', 'F', 5)),
        op('no', 'No cuenta con salidas de emergencia (solo puerta principal)', inc('OBRA', 'ALTA', 'P', 5))
      ] }
    ]
  },
  {
    n: 11, titulo: 'Espacios Verdes y Exteriores', icono: 'Trees',
    descripcion: 'Patios recreativos, arbolado y veredas públicas.',
    preguntas: [
      { id: 141, texto: '¿Posee espacios verdes o con vegetación?', tipo: 'single_choice', opciones: SI_NO() },
      { id: 143, texto: '¿Existen árboles con riesgo de caída de ramas o desraizamiento?', tipo: 'single_choice', critica: true,
        opciones: SI_NO(inc('PODA/CORTE DE PASTO', 'ALTA', 'F', 6, 'Árboles de gran porte con ramas secas sobre patios o techos')) },
      { id: 144, texto: 'Estado de veredas y accesos peatonales externos', tipo: 'rating_5', opciones: rubrica([
        ['Veredas uniformes, sin desniveles, cazuelas protegidas.'],
        ['Tránsito peatonal seguro sin riesgo.'],
        ['Algunas baldosas levantadas por raíces sin obstrucción severa.', inc('ALBAÑILERIA', 'BAJA', 'F', 2)],
        ['Piedras sueltas, pozos o desniveles peligrosos para alumnos.', inc('ALBAÑILERIA', 'MEDIA', 'F', 4)],
        ['Vereda totalmente destruida o intransitable.', inc('ALBAÑILERIA', 'ALTA', 'F', 6)]
      ]) }
    ]
  },
  {
    n: 12, titulo: 'Accesibilidad Universal', icono: 'Accessibility',
    descripcion: 'Rampas, desniveles, anchos de paso y sanitarios adaptados.',
    preguntas: [
      { id: 148, texto: '¿El establecimiento cuenta con rampas de acceso a nivel de calle o vereda?', tipo: 'single_choice',
        opciones: SI_NO(null, inc('ALBAÑILERIA', 'MEDIA', 'F', 4, 'Falta rampa de acceso para sillas de ruedas')) },
      { id: 152, texto: '¿El establecimiento cuenta con al menos un baño adaptado para personas con movilidad reducida?', tipo: 'single_choice',
        opciones: SI_NO(null, inc('OBRA', 'ALTA', 'P', 6, 'Falta sanitario adaptado para personas con discapacidad')) }
    ]
  },
  {
    n: 13, titulo: 'Equipamiento de Cocina y Comedor (PAICOR)', icono: 'Utensils',
    descripcion: 'Equipamiento de preparación de alimentos, refrigeración y agua caliente.',
    preguntas: [
      { id: 159, texto: 'Estado de Cocina / Anafe', tipo: 'rating_5', opciones: rubrica([
        ['Quemadores limpios, termocuplas de seguridad activas, encendido perfecto.'],
        ['Operativo y limpio sin pérdidas de gas.'],
        ['Quemador sucio o perilla floja.', inc('REPARACION/MANTENIMIENTO DE ARTEFACTOS', 'BAJA', 'F', 2)],
        ['Quemadores tapados, sin termocupla o con olor.', inc('REPARACION/MANTENIMIENTO DE ARTEFACTOS', 'MEDIA', 'F', 4)],
        ['Equipo fuera de servicio o fuga directa de gas en cocina.', inc('REPARACION/MANTENIMIENTO DE ARTEFACTOS', 'ALTA', 'F', 6)]
      ], true) },
      { id: 162, texto: 'Estado de Heladera / Freezer', tipo: 'rating_5', opciones: rubrica([
        ['Temperatura óptima (<4°C), burletes sellados, motor silencioso.'],
        ['Enfría correctamente, buen estado higiénico.'],
        ['Burlete con desgaste o escarcha excesiva.', inc('REPARACION/MANTENIMIENTO DE ARTEFACTOS', 'BAJA', 'F', 2)],
        ['Enfriamiento deficiente o motor funcionando continuo.', inc('REPARACION/MANTENIMIENTO DE ARTEFACTOS', 'MEDIA', 'F', 4)],
        ['Heladera o freezer quemado sin frío (riesgo bromatológico).', inc('REPARACION/MANTENIMIENTO DE ARTEFACTOS', 'ALTA', 'F', 6)]
      ], true) },
      { id: 163, texto: 'Estado de Termotanques / Calefones (Agua caliente)', tipo: 'rating_5', opciones: rubrica([
        ['Termotanque nuevo o desincrustado, válvula de alivio operativa, tiro balanceado.'],
        ['Agua caliente continua y segura.'],
        ['Encendido de piloto difícil o agua tibia.', inc('REPARACION/MANTENIMIENTO DE ARTEFACTOS', 'BAJA', 'F', 2)],
        ['Goteo de válvula o combustión amarilla.', inc('REPARACION/MANTENIMIENTO DE ARTEFACTOS', 'MEDIA', 'F', 4)],
        ['Pérdida de gas o tanque pinchado con pérdida continua de agua.', inc('REPARACION/MANTENIMIENTO DE ARTEFACTOS', 'ALTA', 'F', 6)]
      ], true) }
    ]
  },
  {
    n: 14, titulo: 'Exposición General del Personal', icono: 'MessageSquareText',
    descripcion: 'Espacio libre para que el personal exponga con sus propias palabras sobre el estado edilicio.',
    preguntas: [
      { id: 166, texto: 'Exposición general: indique con sus palabras lo que considere necesario a nivel general sobre la escuela', tipo: 'text', multilinea: true, placeholder: 'Observaciones y comentarios testimoniales del personal...' }
    ]
  }
];

/** Índice plano: id → { pregunta, seccion } */
/* ---------- «No aplica / No posee» en todas las preguntas ---------- */
/**
 * Desde 2026.10-v4 toda pregunta admite «No aplica / No posee», salvo los datos de
 * identificación del relevamiento (#1 institución, #3 técnico, #4 fecha).
 *   · Preguntas con opciones: se agrega la opción VALOR_NA, salvo que ya tengan una
 *     equivalente (#42 «No posee», #91 «No requiere bomba», #159/#162/#163 «No posee»).
 *   · Preguntas numéricas y de texto: la interfaz ofrece un botón «No aplica» que
 *     guarda VALOR_NA como respuesta.
 * Una respuesta «No aplica» cuenta como respondida para la completitud de la
 * dimensión y no genera incidencia ni puntos (motor-ies.js).
 */
export const VALOR_NA = '__na';
export const TEXTO_NA = 'No aplica / No posee';
const SIN_NA = new Set([1, 3, 4]);
const EQUIVALENTES_NA = new Set(['no_posee', 'no_aplica']);

for (const s of SECCIONES) {
  for (const p of s.preguntas) {
    p.admiteNA = !SIN_NA.has(p.id);
    if (!p.admiteNA || !p.opciones) continue;
    if (p.opciones.some(o => o.noAplica || EQUIVALENTES_NA.has(o.valor))) continue;
    p.opciones.push({
      valor: VALOR_NA, texto: TEXTO_NA, incidencia: null, noAplica: true,
      rubrica: 'El ítem no existe en el establecimiento o no corresponde evaluarlo.'
    });
  }
}

/** ¿La respuesta es «No aplica»? (incluye las opciones equivalentes propias de cada pregunta). */
export function esNoAplica(p, valor) {
  if (valor === VALOR_NA) return true;
  if (Array.isArray(valor)) return valor.length === 1 && valor[0] === VALOR_NA;
  return !!p?.opciones?.find(o => o.valor === valor)?.noAplica;
}

export const PREGUNTAS = new Map();
for (const s of SECCIONES) for (const p of s.preguntas) PREGUNTAS.set(p.id, { ...p, seccion: s.n });

/** ¿La pregunta está habilitada según las respuestas actuales? */
export function preguntaVisible(p, respuestas) {
  if (!p.mostrarSi) return true;
  return Object.entries(p.mostrarSi).every(([id, valores]) => {
    const r = respuestas[id];
    return r == null || r === '' ? true : valores.includes(r);
  });
}

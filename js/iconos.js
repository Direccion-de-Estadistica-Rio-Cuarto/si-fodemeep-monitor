/**
 * Íconos del SI FoDeMEEP — Material Symbols Outlined (sistema de diseño de la
 * plantilla, css/iconos.css). La fuente está en assets/fonts/ y el Service
 * Worker la precarga, así que los íconos funcionan sin conexión.
 *
 * Se conservan los nombres internos que ya usaba el sistema (catálogo,
 * PWA y Monitor) y se traducen al nombre del ícono de fonts.google.com/icons.
 * El ícono es siempre decorativo (aria-hidden): el texto visible o el
 * aria-label del botón que lo contiene es el que informa.
 */
const NOMBRES = {
  Building2: 'apartment',
  LayoutGrid: 'grid_view',
  Home: 'home',
  Flame: 'local_fire_department',
  Droplets: 'water_drop',
  Thermometer: 'thermostat',
  Waves: 'waves',
  Bath: 'bathtub',
  Zap: 'bolt',
  ShieldAlert: 'gpp_maybe',
  Trees: 'park',
  Accessibility: 'accessible',
  Utensils: 'restaurant',
  MessageSquareText: 'chat',
  Plus: 'add',
  CloudUpload: 'cloud_upload',
  Settings: 'settings',
  ChevronLeft: 'chevron_left',
  ChevronRight: 'chevron_right',
  Check: 'check',
  TriangleAlert: 'warning',
  Trash2: 'delete',
  Download: 'download',
  WifiOff: 'wifi_off',
  ClipboardList: 'assignment',
  Siren: 'e911_emergency',
  RefreshCw: 'refresh',
  FileText: 'description',
  X: 'close',
  Camera: 'photo_camera',
  Image: 'image',
  Upload: 'upload',
  OpenInNew: 'open_in_new',
  Folder: 'folder',
};

const CLASES = { grande: 'icono--grande', chico: 'icono--chico' };

export function icono(nombre, clase = '') {
  const extra = clase.split(/\s+/).filter(Boolean).map(c => CLASES[c] || c).join(' ');
  return `<span class="icono${extra ? ` ${extra}` : ''}" aria-hidden="true">${NOMBRES[nombre] || 'description'}</span>`;
}

/** Texto visible de un elemento, sin el nombre del ícono (que también es texto). */
export function textoSinIcono(el) {
  return [...el.childNodes].filter(n => !(n.nodeType === 1 && n.classList.contains('icono'))).map(n => n.textContent).join('').trim();
}

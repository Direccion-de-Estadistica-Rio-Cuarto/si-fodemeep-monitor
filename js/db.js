/**
 * Persistencia local (IndexedDB) — estrategia Offline-First.
 * Cada relevamiento se guarda completo en el dispositivo; la sincronización
 * con Google Sheets es posterior y reintentable.
 */
const NOMBRE_BD = 'fodemeep-rcu';
const VERSION_BD = 1;
let _bd;

function abrir() {
  if (_bd) return _bd;
  _bd = new Promise((ok, error) => {
    const req = indexedDB.open(NOMBRE_BD, VERSION_BD);
    req.onupgradeneeded = () => {
      const bd = req.result;
      if (!bd.objectStoreNames.contains('relevamientos')) {
        const st = bd.createObjectStore('relevamientos', { keyPath: 'id' });
        st.createIndex('estado', 'estado');
      }
      if (!bd.objectStoreNames.contains('config')) bd.createObjectStore('config');
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => error(req.error);
  });
  return _bd;
}

async function tx(almacen, modo, fn) {
  const bd = await abrir();
  return new Promise((ok, error) => {
    const t = bd.transaction(almacen, modo);
    const st = t.objectStore(almacen);
    const res = fn(st);
    // Si fn devolvió una solicitud de IndexedDB, se entrega su resultado (undefined si el registro no existe).
    t.oncomplete = () => ok(res instanceof IDBRequest ? res.result : res);
    t.onerror = () => error(t.error);
  });
}

export const db = {
  listar: () => tx('relevamientos', 'readonly', st => st.getAll()),
  obtener: id => tx('relevamientos', 'readonly', st => st.get(id)),
  guardar: r => tx('relevamientos', 'readwrite', st => st.put(r)),
  eliminar: id => tx('relevamientos', 'readwrite', st => st.delete(id)),
  leerConfig: clave => tx('config', 'readonly', st => st.get(clave)),
  escribirConfig: (clave, valor) => tx('config', 'readwrite', st => st.put(valor, clave))
};

export function nuevoId() {
  return (crypto.randomUUID ? crypto.randomUUID() : 'r-' + Date.now() + '-' + Math.random().toString(16).slice(2));
}

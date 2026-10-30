# datos/ — capas geográficas del Monitor Ejecutivo

## barrios-rio-cuarto.geojson

- **Qué es:** la distribución barrial de Río Cuarto que dibuja el mapa territorial del Monitor (62 polígonos, atributos `codvec` y `nombre`).
- **Fuente:** capa «Barrios» del repositorio [Mapas](https://github.com/Direccion-de-Estadistica-Rio-Cuarto/Mapas) de la Dirección de Estadística: `Barrios/2026_barrios_estandarizados.zip`, commit `876b84a` (01/10/2026). Es la única capa de ese repositorio que usa el sistema.
- **Transformación:** del shapefile original en POSGAR 98 / Argentina faja 4 (EPSG:22174) a WGS 84 (EPSG:4326), en GeoJSON RFC 7946. Coordenadas redondeadas a 6 decimales (≈ 0,1 m) y anillos orientados según la regla de la mano derecha. Las geometrías no se simplificaron ni se modificaron.
- **Datos personales:** no contiene. Son límites barriales públicos.

### Para actualizarla

Cuando cambie la capa en el repositorio Mapas, hay que regenerar el archivo. Con QGIS: abrir `2026_barrios_estandarizados.qgz` y exportar la capa con *Exportar → Guardar objetos como…*, formato GeoJSON, SRC EPSG:4326, conservando solo `codvec` y `nombre`. Con GDAL:

```bash
ogr2ogr -f GeoJSON -t_srs EPSG:4326 -lco RFC7946=YES -lco COORDINATE_PRECISION=6 \
  -select codvec,nombre datos/barrios-rio-cuarto.geojson 2026_barrios_estandarizados.shp
```

## Para qué se usa

1. **Dibujar la distribución barrial** en el mapa territorial del Monitor.
2. **Definir el barrio de cada escuela.** Regla del sistema: el barrio es siempre el del polígono donde caen las coordenadas de la escuela, aunque el padrón o la planilla digan otro (`js/barrios.js`, compartido por la PWA y el Monitor). Si una escuela tiene varios puntos, se listan sus barrios separados por « | ». Si cae fuera de todos los polígonos, queda «Sin barrio asignado». Si no tiene coordenadas, se conserva el barrio del padrón.

El Service Worker la precarga para que la PWA asigne barrios sin conexión, y la pide primero a la red, así siempre se usa la versión publicada. Si se regenera esta capa, hay que regenerar también el barrio de `js/padron-inicial.js` y `apps-script/PadronInicial.gs` y ejecutar `cargarPadronInicial` en Apps Script, para que la hoja «Instituciones» quede igual.

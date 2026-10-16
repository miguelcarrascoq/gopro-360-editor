# 🎥 GoPro 360 Editor

Herramienta local, gratuita y de escritorio para ver, recortar y exportar archivos `.360` de GoPro MAX / MAX 2 como videos equirectangulares MP4 compatibles con YouTube y reproductores 360.

## ✨ Características

- **Vista previa interactiva 360°**: Arrastra el mouse para mirar alrededor en el video
- **Recorte visual**: Selecciona inicio y fin en una línea de tiempo interactiva
- **Exportación a MP4**: Convierte a formato equirectangular con metadatos esféricos automáticos
- **Preserva audio**: Mantiene todas las pistas de audio del archivo original
- **Calidad ajustable**: Elige entre alta, media o baja calidad para la exportación
- **Interfaz web local**: Accede desde tu navegador sin enviar datos a la nube
- **CLI incluida**: Herramienta de línea de comandos para conversiones por lotes

## 🔧 Requisitos del sistema

- macOS (Apple Silicon o Intel, aunque cualquier plataforma con Node y ffmpeg funcionará)
- [Node.js](https://nodejs.org/) v18 o superior (ya instalado según los requisitos)
- [ffmpeg](https://ffmpeg.org/) con soporte para `v360` (ya instalado según los requisitos)

### Verificar instalación

```bash
node --version  # Debería mostrar v18.0.0 o superior
ffmpeg -version # Debería incluir el filtro v360
```

## 📦 Instalación

1. **Clonar o descargar este repositorio**:

```bash
git clone <repo-url>
cd gopro-360-editor
```

2. **Instalar dependencias**:

```bash
npm install
```

¡Eso es todo! No se requiere configuración adicional.

## 🚀 Uso

### Modo interfaz web (recomendado)

1. **Iniciar el servidor**:

```bash
npm start
```

2. **Abrir en el navegador**:

Navega a [http://localhost:3000](http://localhost:3000)

3. **Cargar archivo**:
   - Pega la ruta completa de tu archivo `.360` (ejemplo: `/Users/tu-nombre/Videos/GS010001.360`)
   - Haz clic en "Cargar archivo"

4. **Generar vista previa**:
   - Haz clic en "Generar vista previa" (esto puede tardar unos minutos)
   - Una vez lista, verás el video 360° interactivo
   - **Arrastra con el mouse** para mirar alrededor
   - Usa el botón **▶** para reproducir/pausar

5. **Recortar (opcional)**:
   - Arrastra el marcador **verde** (inicio) y **rojo** (fin) en la línea de tiempo
   - Verás la duración del segmento seleccionado en tiempo real

6. **Exportar**:
   - Selecciona la calidad deseada:
     - **Alta**: Mejor calidad, archivos más grandes, conversión más lenta (CRF 18)
     - **Media**: Balance entre calidad y tamaño (CRF 23, recomendado)
     - **Baja**: Conversión rápida, menor calidad (CRF 28)
   - Ingresa un nombre para el archivo (opcional)
   - Haz clic en "Exportar MP4"
   - El archivo se guardará en la carpeta `temp/` del proyecto

### Modo línea de comandos (CLI)

Perfecto para conversiones por lotes o scripts automatizados.

**Ver información de un archivo**:

```bash
npm run cli info /ruta/a/tu/video.360
```

**Convertir archivo completo**:

```bash
npm run cli convert /ruta/a/tu/video.360 salida.mp4
```

**Convertir segmento recortado**:

```bash
npm run cli convert /ruta/a/tu/video.360 salida.mp4 --start 30 --end 120 --quality high
```

Opciones del CLI:
- `--start <segundos>`: Tiempo de inicio del recorte (default: 0)
- `--end <segundos>`: Tiempo de fin del recorte (default: duración completa)
- `--quality <nivel>`: Calidad de salida - `high`, `medium`, `low` (default: medium)

**Ejemplo completo**:

```bash
# Exportar del segundo 10 al 45 con calidad alta
npm run cli convert ~/Videos/GS010001.360 mi_clip.mp4 --start 10 --end 45 --quality high
```

## 🧪 Pruebas

Ejecutar las pruebas automáticas (genera archivos de prueba sintéticos y valida la conversión):

```bash
npm test
```

Las pruebas verifican:
- Generación de archivos de prueba con dual-stream
- Validación de archivos .360
- Conversión a formato equirectangular
- Relación de aspecto 2:1 correcta
- Preservación de audio
- Precisión del recorte

## 📁 Estructura del proyecto

```
gopro-360-editor/
├── src/
│   ├── server.js              # Servidor Express con API REST y WebSocket
│   ├── gopro-processor.js     # Lógica de procesamiento con ffmpeg
│   ├── cli.js                 # Herramienta de línea de comandos
│   ├── test-generator.js      # Generador de archivos de prueba
│   └── gopro-processor.test.js # Suite de pruebas
├── public/
│   ├── index.html             # Interfaz web
│   └── app.js                 # Cliente JavaScript con three.js
├── temp/                      # Archivos temporales y exportaciones
├── test-output/               # Salida de las pruebas
├── package.json
└── README.md
```

## 🎯 Cómo funciona

### Archivos `.360` de GoPro

Los archivos GoPro MAX `.360` contienen:
- **Stream 0**: Video frontal en formato EAC (HEVC)
- **Stream 1**: Video trasero en formato EAC (HEVC)
- **Stream 2**: Audio (AAC)
- **Stream 3**: Telemetría GPMF (opcional)

### Proceso de conversión

1. **Extracción**: Se extraen ambos streams de video HEVC
2. **Apilamiento**: Los streams se apilan verticalmente (frontal arriba, trasero abajo)
3. **Conversión**: El filtro `v360` de ffmpeg convierte de EAC a equirectangular
4. **Recodificación**: Se codifica a H.264 para compatibilidad con navegadores
5. **Inyección de metadatos**: Se agregan metadatos esféricos para YouTube y reproductores 360

La conversión usa el siguiente comando ffmpeg (simplificado):

```bash
ffmpeg -i input.360 \
  -filter_complex "[0:v:0][0:v:1]vstack=inputs=2[stacked];[stacked]v360=eac:e:cubic:3840:1920" \
  -c:v libx264 -preset medium -crf 23 \
  -c:a aac -b:a 192k \
  output.mp4
```

## 🐛 Solución de problemas

### "File not found" o "Not a dual-stream .360 file"

- Asegúrate de que la ruta del archivo es correcta y completa
- Verifica que el archivo sea realmente un `.360` de GoPro MAX (no un archivo renombrado)

### La vista previa no carga o se ve negra

- Espera a que la conversión de vista previa termine (puede tardar varios minutos)
- Verifica la consola del navegador (F12) para errores
- Asegúrate de que el puerto 3000 no esté bloqueado

### ffmpeg no encontrado

```bash
# En macOS con Homebrew:
brew install ffmpeg

# En Linux (Ubuntu/Debian):
sudo apt install ffmpeg

# Verificar instalación:
ffmpeg -version
```

### La conversión es muy lenta

- Usa calidad "baja" para pruebas rápidas
- La conversión de archivos grandes (4K+) puede tardar tiempo
- Los ajustes de "alta calidad" usan el preset "slow" que es mucho más lento

### Los archivos exportados son muy grandes

- Reduce la calidad a "media" o "baja"
- Los videos 360° son naturalmente grandes (3840x1920 a 30fps)
- Considera comprimir el archivo final con herramientas adicionales si es necesario

## 🌐 Compatibilidad del formato de salida

Los archivos MP4 exportados son compatibles con:

- ✅ YouTube (upload directo como video 360°)
- ✅ Facebook 360
- ✅ VLC Media Player
- ✅ GoPro Player (como video equirectangular)
- ✅ Reproductores de video 360° web
- ✅ Visores de realidad virtual

El video resultante tiene:
- Formato: MP4 (H.264 + AAC)
- Proyección: Equirectangular (2:1 aspect ratio)
- Metadatos: Spherical video (Google spatial media)
- Resolución: 3840x1920 (4K) o según la fuente

## 📝 Notas técnicas

- **EAC vs Equirectangular**: EAC (Equi-Angular Cubemap) es el formato nativo de GoPro MAX, más eficiente para almacenamiento pero no compatible con reproductores estándar. La conversión a equirectangular permite reproducción universal.

- **Calidad de conversión**: El filtro `v360` con método `cubic` proporciona buena calidad con rendimiento razonable. Para máxima calidad se podría usar `lanczos` pero es significativamente más lento.

- **Metadatos esféricos**: Se inyectan usando el estándar de Google Spatial Media para garantizar que YouTube y otros servicios detecten automáticamente el video como 360°.

- **Vista previa web**: Los navegadores no pueden reproducir HEVC directamente, por lo que se genera una conversión a H.264 de menor resolución para la vista previa interactiva.

## 🤝 Contribuciones

Este es un proyecto de código abierto. Mejoras, correcciones de bugs y nuevas características son bienvenidas.

## 📄 Licencia

MIT - Usa, modifica y distribuye libremente.

## 🙏 Agradecimientos

- [three.js](https://threejs.org/) para renderizado 3D/360° en el navegador
- [ffmpeg](https://ffmpeg.org/) por el potente procesamiento de video
- Comunidad de GoPro MAX por documentación del formato .360

---

**¿Preguntas o problemas?** Abre un issue en el repositorio del proyecto.

¡Disfruta convirtiendo tus videos 360°! 🎬✨

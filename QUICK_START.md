# Inicio Rápido - GoPro 360 Editor

## ⚡ Comenzar en 3 pasos

### 1. Instalar dependencias

```bash
npm install
```

### 2. Iniciar la aplicación

```bash
npm start
```

### 3. Abrir en el navegador

Navega a [http://localhost:3000](http://localhost:3000)

## 🎬 Flujo de trabajo típico

1. **Pega la ruta** de tu archivo `.360` en el campo de texto
   - Ejemplo: `/Users/tu-nombre/GoPro/GS010001.360`
   
2. **Carga el archivo** - click en "Cargar archivo"

3. **Genera vista previa** - click en "Generar vista previa"
   - Espera 2-5 minutos dependiendo del tamaño del archivo
   - La vista previa te permite explorar el video 360° arrastrando con el mouse

4. **Recorta (opcional)** - arrastra los marcadores verde y rojo

5. **Exporta** - selecciona calidad y click en "Exportar MP4"
   - El archivo se guarda en la carpeta `temp/`

## 💡 Consejos

- **Primera vez**: Usa calidad "baja" para probar rápidamente
- **Para YouTube**: Usa calidad "alta" o "media"
- **Archivos grandes**: La conversión puede tardar 10-20 minutos
- **Vista previa**: Puedes reproducir y navegar el video mientras decides dónde recortar

## 🛠️ Conversión por línea de comandos

Si prefieres la terminal:

```bash
# Ver información
npm run cli info /ruta/a/archivo.360

# Convertir completo
npm run cli convert /ruta/a/archivo.360 salida.mp4

# Recortar y convertir
npm run cli convert /ruta/a/archivo.360 salida.mp4 --start 30 --end 120 --quality high
```

## ❓ Problemas comunes

**"File not found"**
- Verifica la ruta completa del archivo
- En macOS, arrastra el archivo a la terminal para obtener la ruta

**"Not a dual-stream .360 file"**
- El archivo debe ser de GoPro MAX o MAX 2
- No funciona con archivos .360 de otras cámaras

**La vista previa no carga**
- Espera a que termine la conversión (verás progreso en pantalla)
- Verifica que el puerto 3000 esté libre

## 📱 Siguiente paso: Subir a YouTube

1. Una vez exportado, ve a [YouTube Studio](https://studio.youtube.com)
2. Click en "Subir videos"
3. Selecciona tu archivo MP4 exportado
4. YouTube detectará automáticamente que es un video 360°
5. ¡Listo! El video será procesable como 360° en YouTube

---

Para documentación completa, consulta [README.md](README.md)

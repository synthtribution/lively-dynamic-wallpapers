# Fondos de Pantalla Dinámicos para Lively Wallpaper

Sistema ligero de rotación de fondos de pantalla (imágenes y videos) para múltiples monitores en Windows usando **Lively Wallpaper** y un servidor local en **Node.js puro** (sin `npm install`, sin dependencias externas).

## ✨ Características

- **Monitores Múltiples:** Soporte para modo **Duplicado** o **Independiente** por pantalla (detecta geometrías y resoluciones distintas).
- **Modos SFW y NSFW:** Alternancia con un clic. En NSFW permite filtrar entre *Mixto*, *Solo Fotos* o *Solo Videos*.
- **Videos Inteligentes:** Inicio en timestamp aleatorio sin saltar el final del video, loop automático y control de audio independiente por pantalla.
- **Historial Reciente (5 items):** Miniaturas con badge `▶` en videos, navegación hacia atrás/adelante y enlace directo a **Pixiv** si el archivo proviene de ahí.
- **Botón Carpeta 📂:** Revela y selecciona el archivo original en el Explorador de Windows con un clic.
- **HUD Glassmorphism:** Panel desplegable al pasar el ratón por la esquina inferior derecha, fijable con 📌.
- **Cero Dependencias:** Corre en Node.js nativo consumiendo ~30-40 MB de RAM.

---

## 🚀 Requisitos

1. [Node.js](https://nodejs.org/) (versión 18 o superior).
2. [Lively Wallpaper](https://rocksdanister.github.io/lively/) (desde la Microsoft Store o instalador).

---

## 🛠️ Instalación y Configuración

1. **Clonar el repositorio:**
   ```bash
   git clone https://github.com/TU_USUARIO/fondos-de-pantalla.git
   cd fondos-de-pantalla
   ```

2. **Crear tu configuración:**
   Copia el archivo de ejemplo:
   ```bash
   copy config.example.json config.json
   ```
   Abre `config.json` con tu editor preferido y coloca las rutas de tus carpetas de imágenes y videos:
   ```json
   {
     "port": 38421,
     "folders": {
       "sfwImages": "C:\\Users\\TuUsuario\\Pictures\\SFW",
       "nsfwImages": "C:\\Users\\TuUsuario\\Pictures\\NSFW",
       "nsfwVideos": "C:\\Users\\TuUsuario\\Videos\\NSFW"
     },
     "maxHistory": 5,
     "defaultIntervalSeconds": 10
   }
   ```

3. **Agregar el wallpaper a Lively:**
   - Abre **Lively Wallpaper**.
   - Haz clic en **Añadir fondo** (+).
   - Elige **Elegir un archivo** y selecciona la carpeta `wallpaper` (o el archivo `wallpaper/LivelyInfo.json`).
   - Aplícalo a tus pantallas.

---

## ⚡ Ejecución

- **Iniciar:** Doble clic en `iniciar-servidor.bat` (arranca en segundo plano).
- **Reiniciar:** Doble clic en `reiniciar-servidor.bat`.
- **Detener:** Doble clic en `detener-servidor.bat`.
- **Autoinicio silencioso con Windows:**
  - Ejecuta `instalar-autoinicio.bat` para que arranque en segundo plano sin ventanas negras al iniciar sesión.
  - Para quitarlo, ejecuta `quitar-autoinicio.bat`.

---

## 🔒 Privacidad y Git

Los archivos `config.json` (con tus rutas privadas de carpetas y usuario de Windows) y `state.json` (el estado actual de reproducción) están ignorados en `.gitignore` para prevenir cualquier fuga de información sensible.

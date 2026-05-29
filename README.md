# CRM de Alquiler Vacacional

Aplicación web para gestionar el alquiler vacacional de apartamentos desde la oficina.
Funciona en **red local sin internet**: se instala en un ordenador (el "servidor") y los
demás equipos de la oficina acceden con el navegador.

## Módulos

- **Planning**: vista mensual con los apartamentos en filas y los días en columnas. Cada
  reserva es una barra de color. Navegación entre meses, filtro por TIH (1ª/2ª línea),
  ficha de cada reserva, eliminación manual y **arrastrar y soltar** para mover una
  reserva de un apartamento a otro.
- **Importación**: botón "Importar reservas" que acepta `.xlsx`, `.xls` y `.csv`. Las
  reservas se asignan automáticamente a un apartamento libre de su misma TIH; si no queda
  ninguno libre para esas fechas, la reserva queda en la bandeja **"Sin asignar"** y se
  marca como incidencia en el resumen.
- **Alojamientos**: alta, edición, borrado y ficha de cada apartamento (con propietario e
  historial de reservas).
- **Propietarios**: alta, edición, borrado y ficha (con sus alojamientos asociados).

### Columnas esperadas del archivo de reservas

`Reserva | Nombre Cliente | Contrato | Edificio | TIH | Per. | Entrada | Salida | Observaciones`

- **Reserva**: identificador único. Si ya existe, se **actualiza**; si no, se **crea**.
- **TIH**: `1 Línea` o `2 Línea`.
- **Entrada / Salida**: fechas en formato `DD/MM/AAAA` (también se admite el formato
  numérico interno de Excel).
- Nunca se borran reservas automáticamente: las cancelaciones se gestionan a mano.

---

## Instalación (solo una vez, en el ordenador servidor)

### 1. Instalar Node.js
1. En un equipo con internet, descarga **Node.js LTS** desde <https://nodejs.org>.
2. Ejecuta el instalador y acepta las opciones por defecto.
3. Comprueba la instalación abriendo PowerShell y escribiendo:
   ```powershell
   node --version
   npm --version
   ```
   Deben mostrar un número de versión.

### 2. Instalar las dependencias del proyecto
Abre PowerShell **dentro de la carpeta del proyecto** (donde está `server.js`) y ejecuta:
```powershell
npm install
```
> Esto requiere internet **una sola vez**. Después, la aplicación funciona sin conexión.
> Si el servidor no tiene internet, ejecuta `npm install` en otro equipo y copia toda la
> carpeta del proyecto (incluida `node_modules`) al servidor.

---

## Arrancar el servidor

En la carpeta del proyecto:
```powershell
node server.js
```
Verás algo como:
```
 Local:  http://localhost:3000
 Red:    http://192.168.1.50:3000   (acceso desde otros ordenadores)
```
Para detener el servidor: **Ctrl + C**. Deja esta ventana abierta mientras se use el CRM.

---

## Acceder desde los otros ordenadores de la oficina

1. En el ordenador servidor, averigua su dirección IP:
   ```powershell
   ipconfig
   ```
   Busca la línea **Dirección IPv4** (por ejemplo `192.168.1.50`).
2. En cada uno de los otros ordenadores, abre el navegador y entra en:
   ```
   http://192.168.1.50:3000
   ```
   (sustituye la IP por la del servidor).

### Si los demás equipos no pueden conectar (firewall de Windows)
La primera vez puede que Windows pida permiso para Node.js: pulsa **Permitir acceso** en
**redes privadas**. Si no apareció el aviso, abre el puerto manualmente (PowerShell como
administrador en el servidor):
```powershell
New-NetFirewallRule -DisplayName "CRM Alquiler 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

---

## Arranque automático (opcional)

Para no tener que ejecutar `node server.js` a mano cada vez:
1. Crea un archivo `iniciar-crm.bat` en la carpeta del proyecto con este contenido:
   ```bat
   @echo off
   cd /d "%~dp0"
   node server.js
   ```
2. Crea un acceso directo a ese `.bat` y colócalo en la carpeta de Inicio de Windows
   (pulsa `Win + R`, escribe `shell:startup` y pega ahí el acceso directo).

---

## Estructura del proyecto

```
server.js          Arranque del servidor Express (puerto 3000)
db/                Base de datos SQLite (se crea sola) y esquema
routes/            API REST: apartamentos, propietarios, reservas, importar
services/          Importación, utilidades de fecha y lógica de asignación
public/            Frontend (HTML, CSS y JavaScript)
```

Los datos se guardan en `db/crm.db`. **Haz copias de seguridad de ese archivo**
periódicamente (basta con copiarlo).

---

## Tecnología

Node.js + Express · SQLite (better-sqlite3) · HTML/CSS/JavaScript sin frameworks.

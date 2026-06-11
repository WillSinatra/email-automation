# Manual de uso - Herramienta local de automatizacion de correos

## Nota de inicio y stop rapido (script raiz)
1. Desde la carpeta raiz, inicie ambos servicios con un solo comando:

```bash
npm run dev
```

2. Para detener ambos servicios a la vez, presione Ctrl + C en esa misma terminal.

## 1. Requisitos previos
1. Abra una terminal.
2. Verifique Node.js:

```bash
node -v
```

3. Verifique npm:

```bash
npm -v
```

Explicacion: Si ambos comandos muestran un numero, puede continuar. Si falla alguno, instale Node.js y repita.

## 2. Instalacion
1. Descargue o clone el proyecto.
2. Entre a la carpeta del proyecto en la terminal.
3. Instale dependencias del backend:

```bash
cd backend
npm install
```

4. Instale dependencias del frontend:

```bash
cd ..
cd frontend
npm install
```

Que hace este paso?: Descarga todo lo necesario para ejecutar la herramienta en su PC.

## 3. Configuracion inicial
1. Entre a la carpeta `backend`.
2. Cree o edite el archivo `.env`.
3. Agregue este contenido:

```env
PORT=3001
```

4. Guarde el archivo.

Que hace este paso?: Define el puerto del servidor interno de la herramienta.

## 4. Como iniciar la herramienta
1. Abra una terminal para backend.
2. Inicie backend:

```bash
cd backend
npm start
```

3. Abra otra terminal para frontend.
4. Inicie frontend en puerto 5173:

```bash
cd frontend
npm run dev -- --port 5173
```

5. Abra el navegador en:

```text
http://localhost:5173
```

Que hace este paso?: Levanta las dos partes de la app: backend (3001) y pantalla web (5173).

## 5. Como conectarse a un servidor de correo
1. Complete Host / server address.
2. Complete Port (normalmente 993 para IMAP seguro).
3. Complete Username / email.
4. Complete Password.
5. Presione `Connect`.

Explicacion: Estos datos se encuentran en la configuracion IMAP de su proveedor de correo. Si no los tiene, pidaselos al administrador o soporte de correo.

## 6. Como leer y filtrar correos
1. Presione `Fetch emails` para traer correos.
2. Use filtros por categoria: All, Trusted, Spam, Ignored.
3. Use el filtro por dominio para escribir parte del dominio (por ejemplo: gmail.com).

Explicacion: Los filtros se aplican sobre correos ya cargados. No necesita recargar para cada filtro.

## 7. Como agregar reglas personalizadas de dominio
1. Abra `Custom domain rules`.
2. Escriba un dominio (por ejemplo: empresa.com).
3. Elija categoria: trusted, spam o ignored.
4. Presione `Add rule`.
5. Para eliminar una regla, use `Remove` en esa fila.

Que hace este paso?: Permite decidir manualmente como clasificar dominios especificos.

## 8. Como limpiar la base de datos
1. Presione `Clear database`.
2. Confirme la accion cuando aparezca el mensaje.

Explicacion: Esto borra correos guardados localmente. No borra correos reales de su cuenta.

## 9. Como detener la herramienta
1. Vaya a la terminal del backend.
2. Presione `Ctrl + C`.
3. Vaya a la terminal del frontend.
4. Presione `Ctrl + C`.

Explicacion: Debe detener ambas terminales para apagar por completo la herramienta.

## 10. Solucion de problemas comunes

### "No puedo conectarme al servidor"
1. Revise host, puerto, usuario y contrasena.
2. Confirme que IMAP este habilitado en su cuenta.
3. Si su proveedor lo pide, use contrasena de aplicacion.

Que hace este paso?: Verifica errores tipicos de configuracion y seguridad del correo.

### "La pagina no carga"
1. Confirme que el frontend este ejecutandose en 5173.
2. Abra exactamente `http://localhost:5173`.
3. Reinicie frontend si hace falta:

```bash
cd frontend
npm run dev -- --port 5173
```

### "El backend no arranca"
1. Verifique que exista `backend/.env` con `PORT=3001`.
2. Verifique que instalacion de dependencias en backend se haya hecho.
3. Inicie backend de nuevo:

```bash
cd backend
npm start
```

4. Si el puerto 3001 esta ocupado, cierre la aplicacion que lo usa o cambie el puerto en `.env`.

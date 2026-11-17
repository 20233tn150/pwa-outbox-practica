// Registro de Service Worker y recepción de mensajes (postMessage)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
      console.log('[UI] Confirmación recibida del Service Worker. Actualizando bandeja...');
      renderizarColaOutbox();
    }
  });
}


// 1. Indicador visual del estado de red
function actualizarIndicadorRed() {
  const indicador = document.getElementById('badge-red');
  if (!indicador) return;

  if (navigator.onLine) {
    indicador.textContent = 'En línea (Online)';
    indicador.className = 'badge online';
  } else {
    indicador.textContent = 'Sin conexión (Offline)';
    indicador.className = 'badge offline';
  }
}


// 2. Procesar envío de reporte (Intenta red; si falla, encola como 'pendiente')
function procesarEnvioReporte(datosFormulario) {
  const endpoint = 'https://jsonplaceholder.typicode.com/posts';

  return fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datosFormulario)
  })
    .then((respuesta) => {
      if (!respuesta.ok) throw new Error('Error HTTP del servidor');
      return respuesta.json();
    })
    .then(() => {
      // Envío exitoso en vivo: registrar en bitácora local como sincronizado
      return guardarRegistro({
        ...datosFormulario,
        estado: 'sincronizado',
        fechaCreacion: Date.now()
      });
    })
    .catch(() => {
      console.warn('[Outbox] Sin conexión. Encolando en IndexedDB...');

      return guardarRegistro({
        ...datosFormulario,
        estado: 'pendiente',
        fechaCreacion: Date.now()
      })
        .then(() => {
          // Detección de soporte para Background Sync API
          if ('serviceWorker' in navigator && 'SyncManager' in window) {
            return navigator.serviceWorker.ready
              .then((registro) => {
                console.log('[Outbox] Registrando etiqueta sync-reportes en el SW...');
                return registro.sync.register('sync-reportes');
              });
          }
        });
    })
    .then(() => {
      // Actualizar la lista visual en ambos escenarios
      return renderizarColaOutbox();
    });
}


// 3. Sincronizar transacciones pendientes al recuperar conectividad
function sincronizarPendientesFallback() {
  console.log('[Outbox] Conexión detectada. Buscando registros pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[Outbox] No hay transacciones pendientes por sincronizar.');
        return;
      }

      // Convertir cada registro pendiente en una promesa de envío + actualización
      const promesasDeEnvio = pendientes.map((item) => {
        return fetch('https://jsonplaceholder.typicode.com/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        }).then((res) => {
          if (!res.ok) throw new Error('Falla al reintentar envío');
          // Actualizar estado en IndexedDB de 'pendiente' a 'sincronizado'
          return actualizarEstadoRegistro(item.id, 'sincronizado');
        });
      });

      // Esperar a que todos los reenvíos concluyan
      return Promise.all(promesasDeEnvio);
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('[Outbox] Error durante la sincronización masiva:', error);
    });
}


// 4. Renderizar la cola de IndexedDB en el DOM (READ)
function renderizarColaOutbox() {
  const listaOutbox = document.getElementById('lista-outbox');
  if (!listaOutbox) return Promise.resolve();

  return obtenerTodosLosRegistros()
    .then((registros) => {
      listaOutbox.innerHTML = '';

      if (registros.length === 0) {
        listaOutbox.innerHTML = '<li class="vacio">No hay registros en la cola local.</li>';
        return;
      }

      registros.forEach((item) => {
        const li = document.createElement('li');
        li.className = `item-outbox ${item.estado}`;

        const horaFormateada = item.fechaCreacion
          ? new Date(item.fechaCreacion).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            })
          : '--:--';

        li.innerHTML = `
          <div class="info">
            <strong>${item.titulo}</strong>
            <p>${item.descripcion || ''}</p>
            <small>Registrado: ${horaFormateada}</small>
          </div>
          <span class="badge-${item.estado}">${item.estado.toUpperCase()}</span>
        `;

        listaOutbox.appendChild(li);
      });
    })
    .catch((error) => {
      console.error('[Outbox] Error al renderizar la cola:', error);
    });
}

// 5. Conexión del Formulario (CREATE - submit)
const formIncidencia = document.getElementById('form-incidencia');
if (formIncidencia) {
  formIncidencia.addEventListener('submit', (e) => {
    e.preventDefault();

    const datosFormulario = {
      titulo: document.getElementById('titulo').value.trim(),
      descripcion: document.getElementById('descripcion').value.trim()
    };

    if (!datosFormulario.titulo) return;

    procesarEnvioReporte(datosFormulario).then(() => {
      formIncidencia.reset();
    });
  });
}

// 6. Purga de Registros Enviados (DELETE)
const btnPurgar = document.getElementById('btn-purgar');
if (btnPurgar) {
  btnPurgar.addEventListener('click', () => {
    obtenerTodosLosRegistros()
      .then((registros) => {
        const sincronizados = registros.filter((item) => item.estado === 'sincronizado');

        if (sincronizados.length === 0) {
          console.log('[Outbox] No hay registros sincronizados para purgar.');
          return Promise.resolve();
        }

        const promesasDeBorrado = sincronizados.map((item) => {
          return eliminarRegistro(item.id);
        });

        return Promise.all(promesasDeBorrado);
      })
      .then(() => {
        return renderizarColaOutbox();
      })
      .catch((error) => {
        console.error('[Outbox] Error al purgar registros sincronizados:', error);
      });
  });
}


window.addEventListener('online', () => {
  actualizarIndicadorRed();

  // Degradación elegante: Solo sincronizar desde UI si el navegador NO soporta Background Sync (ej. Safari/iOS)
  if (!('SyncManager' in window)) {
    console.log('[Outbox] Navegador sin SyncManager. Ejecutando fallback por evento online...');
    sincronizarPendientesFallback();
  }
});

window.addEventListener('offline', actualizarIndicadorRed);

// Registro del Service Worker con ruta relativa (obligatorio para GitHub Pages)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('./sw.js')
    .then(() => console.log('[SW] Registrado correctamente.'))
    .catch((err) => console.error('[SW] Error al registrar:', err));
}

// Arrancar estado inicial al cargar la página
actualizarIndicadorRed();
renderizarColaOutbox();
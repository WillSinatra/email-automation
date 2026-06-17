const NOTIFICATION_DURATION_MS = 120000 // 2 minutes max auto-close
let permissionRequested = false

export function isNotificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

export async function requestNotificationPermission() {
  if (!isNotificationSupported()) return 'unsupported'
  if (permissionRequested) return Notification.permission
  permissionRequested = true

  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission
  }

  try {
    const result = await Notification.requestPermission()
    return result
  } catch (err) {
    console.error('[notifications] permission request failed:', err.message)
    return 'denied'
  }
}

export function showNotification(title, options = {}) {
  if (!isNotificationSupported()) return null
  if (Notification.permission !== 'granted') return null

  // Only show browser notification when tab is NOT focused,
  // since the in-app banner already covers the focused case
  if (document.hasFocus()) return null

  try {
    const notif = new Notification(title, {
      body: options.body || '',
      icon: options.icon || undefined,
      tag: options.tag || undefined, // prevents duplicate stacking
      silent: options.silent || false,
    })

    const autoCloseMs = options.durationMs || NOTIFICATION_DURATION_MS
    const timer = setTimeout(() => {
      notif.close()
    }, autoCloseMs)

    notif.onclick = () => {
      window.focus()
      notif.close()
      clearTimeout(timer)
      if (options.onClick) options.onClick()
    }

    notif.onclose = () => {
      clearTimeout(timer)
    }

    return notif
  } catch (err) {
    console.error('[notifications] failed to show notification:', err.message)
    return null
  }
}

export function notifyFetchComplete(saved, skipped, newCount) {
  const body = newCount > 0
    ? `Se encontraron ${newCount} correos nuevos. ${saved} guardados, ${skipped} duplicados.`
    : `Sincronización completa. ${saved} guardados, ${skipped} duplicados.`

  return showNotification('Fetch completo — Automatización de correos', {
    body,
    tag: 'fetch-complete',
    durationMs: 15000, // 15 seconds for routine completion
  })
}

export function notifyNewEmailsAvailable(count) {
  return showNotification('Nuevos correos disponibles', {
    body: `Tienes ${count} correos nuevos por revisar.`,
    tag: 'new-emails',
    durationMs: 30000, // 30 seconds, slightly more attention-grabbing
  })
}

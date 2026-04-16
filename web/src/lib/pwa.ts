const serviceWorkerPath = '/web-push-sw.js'

export async function registerAppServiceWorker(
  isDevelopment: boolean = import.meta.env.DEV,
): Promise<void> {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    isDevelopment
  ) {
    return
  }

  try {
    await navigator.serviceWorker.register(serviceWorkerPath)
  } catch (error) {
    console.warn('Failed to register the app service worker.', error)
  }
}

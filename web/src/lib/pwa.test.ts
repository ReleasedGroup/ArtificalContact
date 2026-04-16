import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerAppServiceWorker } from './pwa'

describe('registerAppServiceWorker', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers the shared service worker in production browsers', async () => {
    const register = vi.fn(async () => undefined)

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        serviceWorker: {
          register,
        },
      },
      configurable: true,
    })

    await registerAppServiceWorker(false)

    expect(register).toHaveBeenCalledWith('/web-push-sw.js')
  })

  it('skips registration in development', async () => {
    const register = vi.fn(async () => undefined)

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        serviceWorker: {
          register,
        },
      },
      configurable: true,
    })

    await registerAppServiceWorker(true)

    expect(register).not.toHaveBeenCalled()
  })
})

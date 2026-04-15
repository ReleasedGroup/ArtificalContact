import { afterEach, describe, expect, it, vi } from 'vitest'
import { createReport } from './report'

const mockFetch = vi.fn()

function createJsonResponse<T>(status: number, payload: T) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

describe('createReport', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    mockFetch.mockReset()
  })

  it('posts the report payload and returns the created report summary', async () => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockResolvedValue(
      createJsonResponse(201, {
        data: {
          report: {
            id: 'report-1',
            status: 'open',
            targetType: 'post',
            targetId: 'post-1',
            reasonCode: 'spam',
            createdAt: '2026-04-16T08:00:00.000Z',
          },
        },
        errors: [],
      }),
    )

    const result = await createReport({
      targetType: 'post',
      targetId: 'post-1',
      reasonCode: 'spam',
      details: 'Repeated promo links.',
    })

    expect(result).toEqual({
      id: 'report-1',
      status: 'open',
      targetType: 'post',
      targetId: 'post-1',
      reasonCode: 'spam',
      createdAt: '2026-04-16T08:00:00.000Z',
    })
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/reports',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          targetType: 'post',
          targetId: 'post-1',
          reasonCode: 'spam',
          details: 'Repeated promo links.',
        }),
      }),
    )
  })

  it('surfaces the first API error message on failure', async () => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockResolvedValue(
      createJsonResponse(404, {
        data: null,
        errors: [
          {
            code: 'report_target_not_found',
            message: 'The reported target could not be found.',
            field: 'targetId',
          },
        ],
      }),
    )

    await expect(
      createReport({
        targetType: 'reply',
        targetId: 'missing-reply',
        reasonCode: 'harassment',
      }),
    ).rejects.toThrow('The reported target could not be found.')
  })
})

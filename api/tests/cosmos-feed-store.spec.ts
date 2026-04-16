import type { Container } from '@azure/cosmos'
import { describe, expect, it, vi } from 'vitest'
import {
  CosmosFeedStore,
  MAX_PULL_ON_READ_FOLLOWEES,
} from '../src/lib/cosmos-feed-store.js'
import type { FollowDocument, FollowingListRepository } from '../src/lib/follows.js'

function createFollow(followerId: string, followedId: string): FollowDocument {
  return {
    id: `${followerId}:${followedId}`,
    type: 'follow',
    followerId,
    followedId,
    createdAt: '2026-04-16T00:00:00.000Z',
  }
}

describe('CosmosFeedStore', () => {
  it('bounds the pull-on-read followee set before querying root posts', async () => {
    const viewerId = 'user-viewer'
    const followingRepository: FollowingListRepository = {
      listByFollowerId: vi
        .fn()
        .mockResolvedValueOnce({
          follows: Array.from({ length: 100 }, (_, index) =>
            createFollow(viewerId, `followed-${index + 1}`),
          ),
          continuationToken: 'page-2',
        })
        .mockResolvedValueOnce({
          follows: Array.from({ length: 100 }, (_, index) =>
            createFollow(viewerId, `followed-${index + 101}`),
          ),
          continuationToken: 'page-3',
        })
        .mockResolvedValueOnce({
          follows: Array.from({ length: 100 }, (_, index) =>
            createFollow(viewerId, `followed-${index + 201}`),
          ),
        }),
    }
    const postStore = {
      listRootPostsByAuthorIds: vi.fn(async () => ({
        posts: [],
      })),
    }
    const store = new CosmosFeedStore(
      {} as Container,
      followingRepository,
      postStore as never,
    )

    const result = await store.listPullOnReadFeedEntries(viewerId, {
      limit: 20,
    })

    expect(result).toEqual({ entries: [] })
    expect(followingRepository.listByFollowerId).toHaveBeenCalledTimes(3)
    expect(postStore.listRootPostsByAuthorIds).toHaveBeenCalledWith(
      [
        viewerId,
        ...Array.from({ length: MAX_PULL_ON_READ_FOLLOWEES }, (_, index) =>
          `followed-${index + 1}`,
        ),
      ],
      {
        limit: 20,
      },
    )
  })
})

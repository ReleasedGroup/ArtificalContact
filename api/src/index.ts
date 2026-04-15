import { registerCreateReplyFunction } from './functions/create-reply.js'
import { registerCreateReactionFunction } from './functions/create-reaction.js'
import { registerCounterFunction } from './functions/counter.js'
import { registerDeleteFollowFunction } from './functions/delete-follow.js'
import { registerDeletePostFunction } from './functions/delete-post.js'
import { registerFeedFanOutFunction } from './functions/feed-fanout.js'
import { registerFollowUserFunction } from './functions/follow-user.js'
import { registerFollowersMirrorFunction } from './functions/followers-mirror.js'
import { registerGetFeedFunction } from './functions/get-feed.js'
import { registerGetPostFunction } from './functions/get-post.js'
import { registerGetThreadFunction } from './functions/get-thread.js'
import { registerListFollowersFunction } from './functions/list-followers.js'
import { registerCreatePostFunction } from './functions/create-post.js'
import { registerListFollowingFunction } from './functions/list-following.js'
import { registerGetUserFunction } from './functions/get-user.js'
import { registerHealthFunction } from './functions/health.js'
import { registerMediaUploadUrlFunction } from './functions/media-upload-url.js'
import { registerMediaPostProcessFunctions } from './functions/media-post-process.js'
import { registerUpdateProfileFunction } from './functions/update-profile.js'
import { registerUserPostAuthorSyncFunction } from './functions/user-post-author-sync.js'
import { registerUsersByHandleMirrorFunction } from './functions/users-by-handle-mirror.js'
import { registerAuthMeFunction } from './functions/me.js'

registerCreateReplyFunction()
registerCreateReactionFunction()
registerCounterFunction()
registerDeleteFollowFunction()
registerDeletePostFunction()
registerFeedFanOutFunction()
registerFollowUserFunction()
registerFollowersMirrorFunction()
registerGetFeedFunction()
registerGetPostFunction()
registerGetThreadFunction()
registerListFollowersFunction()
registerCreatePostFunction()
registerListFollowingFunction()
registerGetUserFunction()
registerHealthFunction()
registerMediaUploadUrlFunction()
registerMediaPostProcessFunctions()
registerUpdateProfileFunction()
registerUserPostAuthorSyncFunction()
registerUsersByHandleMirrorFunction()
registerAuthMeFunction()

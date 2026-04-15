import { registerCreateReplyFunction } from './functions/create-reply.js'
import { registerCounterFunction } from './functions/counter.js'
import { registerDeleteFollowFunction } from './functions/delete-follow.js'
import { registerDeletePostFunction } from './functions/delete-post.js'
import { registerFollowUserFunction } from './functions/follow-user.js'
import { registerGetPostFunction } from './functions/get-post.js'
import { registerGetThreadFunction } from './functions/get-thread.js'
import { registerCreatePostFunction } from './functions/create-post.js'
import { registerListFollowingFunction } from './functions/list-following.js'
import { registerGetUserFunction } from './functions/get-user.js'
import { registerHealthFunction } from './functions/health.js'
import { registerMediaUploadUrlFunction } from './functions/media-upload-url.js'
import { registerUpdateProfileFunction } from './functions/update-profile.js'
import { registerUserPostAuthorSyncFunction } from './functions/user-post-author-sync.js'
import { registerUsersByHandleMirrorFunction } from './functions/users-by-handle-mirror.js'
import { registerAuthMeFunction } from './functions/me.js'

registerCreateReplyFunction()
registerCounterFunction()
registerDeleteFollowFunction()
registerDeletePostFunction()
registerFollowUserFunction()
registerGetPostFunction()
registerGetThreadFunction()
registerCreatePostFunction()
registerListFollowingFunction()
registerGetUserFunction()
registerHealthFunction()
registerMediaUploadUrlFunction()
registerUpdateProfileFunction()
registerUserPostAuthorSyncFunction()
registerUsersByHandleMirrorFunction()
registerAuthMeFunction()

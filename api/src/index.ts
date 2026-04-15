import { registerDeletePostFunction } from './functions/delete-post.js'
import { registerGetPostFunction } from './functions/get-post.js'
import { registerGetThreadFunction } from './functions/get-thread.js'
import { registerCreatePostFunction } from './functions/create-post.js'
import { registerGetUserFunction } from './functions/get-user.js'
import { registerHealthFunction } from './functions/health.js'
import { registerUpdateProfileFunction } from './functions/update-profile.js'
import { registerUsersByHandleMirrorFunction } from './functions/users-by-handle-mirror.js'
import { registerAuthMeFunction } from './functions/me.js'

registerDeletePostFunction()
registerGetPostFunction()
registerGetThreadFunction()
registerCreatePostFunction()
registerGetUserFunction()
registerHealthFunction()
registerUpdateProfileFunction()
registerUsersByHandleMirrorFunction()
registerAuthMeFunction()

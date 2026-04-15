import { registerGetUserFunction } from './functions/get-user.js'
import { registerHealthFunction } from './functions/health.js'
import { registerUsersByHandleMirrorFunction } from './functions/users-by-handle-mirror.js'
import { registerAuthMeFunction } from './functions/me.js'

registerGetUserFunction()
registerHealthFunction()
registerUsersByHandleMirrorFunction()
registerAuthMeFunction()

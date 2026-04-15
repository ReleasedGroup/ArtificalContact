import { registerHealthFunction } from './functions/health.js'
import { registerUsersByHandleMirrorFunction } from './functions/users-by-handle-mirror.js'

registerHealthFunction()
registerUsersByHandleMirrorFunction()

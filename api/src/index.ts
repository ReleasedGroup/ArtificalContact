import { registerCreateModActionFunction } from './functions/create-mod-action.js'
import { app } from '@azure/functions'
import { registerCreateReplyFunction } from './functions/create-reply.js'
import { registerCreateReportFunction } from './functions/create-report.js'
import { registerCreateReactionFunction } from './functions/create-reaction.js'
import { registerCounterFunction } from './functions/counter.js'
import { registerDeleteFollowFunction } from './functions/delete-follow.js'
import { registerDeletePostFunction } from './functions/delete-post.js'
import { registerDeleteReactionFunction } from './functions/delete-reaction.js'
import { registerFeedFanOutFunction } from './functions/feed-fanout.js'
import { registerFollowUserFunction } from './functions/follow-user.js'
import { registerGetAdminMetricsFunction } from './functions/get-admin-metrics.js'
import { registerGetFollowRelationshipFunction } from './functions/get-follow-relationship.js'
import { registerFollowersMirrorFunction } from './functions/followers-mirror.js'
import { registerGetFeedFunction } from './functions/get-feed.js'
import { registerGetModerationQueueFunction } from './functions/get-moderation-queue.js'
import { registerGetPublicFeedFunction } from './functions/get-public-feed.js'
import { registerGetNotificationsFunction } from './functions/get-notifications.js'
import { registerGifSearchFunction } from './functions/search-gifs.js'
import { registerSearchFunction } from './functions/search.js'
import { registerGetPostFunction } from './functions/get-post.js'
import { registerGetThreadFunction } from './functions/get-thread.js'
import { registerGetUserFunction } from './functions/get-user.js'
import { registerHealthFunction } from './functions/health.js'
import { registerMarkNotificationsReadFunction } from './functions/mark-notifications-read.js'
import { registerListFollowersFunction } from './functions/list-followers.js'
import { registerListFollowingFunction } from './functions/list-following.js'
import { registerListPostReactionsFunction } from './functions/list-post-reactions.js'
import { registerAuthMeFunction } from './functions/me.js'
import { registerCreatePostFunction } from './functions/create-post.js'
import { registerMediaPostProcessFunctions } from './functions/media-post-process.js'
import { registerMediaUploadUrlFunction } from './functions/media-upload-url.js'
import { registerNotificationFunctions } from './functions/notification.js'
import { registerNotificationPreferencesFunctions } from './functions/notification-preferences.js'
import { registerSearchSyncFunctions } from './functions/search-sync.js'
import { registerUpdateProfileFunction } from './functions/update-profile.js'
import { registerUserPostAuthorSyncFunction } from './functions/user-post-author-sync.js'
import { registerUsersByHandleMirrorFunction } from './functions/users-by-handle-mirror.js'
import { withRequestMetricsContext } from './lib/request-metrics-context.js'

const registerHttpFunction = app.http.bind(app)

app.http = ((name, options) =>
  registerHttpFunction(name, {
    ...options,
    handler: withRequestMetricsContext(options.handler, name),
  })) as typeof app.http

registerCreateModActionFunction()
registerCreateReplyFunction()
registerCreateReportFunction()
registerCreateReactionFunction()
registerCounterFunction()
registerDeleteFollowFunction()
registerDeletePostFunction()
registerDeleteReactionFunction()
registerFeedFanOutFunction()
registerFollowUserFunction()
registerGetAdminMetricsFunction()
registerGetFollowRelationshipFunction()
registerFollowersMirrorFunction()
registerGetFeedFunction()
registerGetModerationQueueFunction()
registerGetPublicFeedFunction()
registerGetNotificationsFunction()
registerGifSearchFunction()
registerSearchFunction()
registerGetPostFunction()
registerGetThreadFunction()
registerGetUserFunction()
registerHealthFunction()
registerMarkNotificationsReadFunction()
registerListFollowersFunction()
registerListFollowingFunction()
registerListPostReactionsFunction()
registerAuthMeFunction()
registerCreatePostFunction()
registerMediaPostProcessFunctions()
registerMediaUploadUrlFunction()
registerNotificationFunctions()
registerNotificationPreferencesFunctions()
registerSearchSyncFunctions()
registerUpdateProfileFunction()
registerUserPostAuthorSyncFunction()
registerUsersByHandleMirrorFunction()

import {
  ApplicationInsights,
  type ITelemetryItem,
} from '@microsoft/applicationinsights-web'

let initialized = false

export function initializeTelemetry() {
  if (initialized) {
    return
  }

  const connectionString =
    import.meta.env.VITE_APPINSIGHTS_CONNECTION_STRING?.trim()

  if (!connectionString) {
    return
  }

  const roleName =
    import.meta.env.VITE_APPINSIGHTS_ROLE_NAME?.trim() ?? 'artificialcontact-web'

  const appInsights = new ApplicationInsights({
    config: {
      connectionString,
      enableAutoRouteTracking: true,
      enableCorsCorrelation: true,
    },
  })

  appInsights.loadAppInsights()
  appInsights.addTelemetryInitializer((item: ITelemetryItem) => {
    const tags = (item.tags ?? {}) as Record<string, string>
    tags['ai.cloud.role'] = roleName
    item.tags = tags
  })
  appInsights.trackPageView({ name: window.location.pathname })

  initialized = true
}

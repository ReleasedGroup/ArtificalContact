# Deployment Guide

## Scope

Sprint 0 provisions the Azure and GitHub scaffolding required to start feature delivery:

- Azure Static Web Apps (Standard)
- Azure Functions (Flex Consumption)
- Azure Cosmos DB for NoSQL + `acn` database
- Azure Storage account + placeholder blob containers
- Azure AI Search (Basic)
- Azure Front Door (Standard) with cache rules for blob delivery
- Key Vault, Log Analytics, and Application Insights

## Local prerequisites

- Node.js 20+
- npm 11+
- Azure CLI with Bicep support
- Azure Developer CLI (`azd`) for end-to-end environment orchestration

## Local validation

```bash
npm install
npm run build
npm run lint
npm run test
az bicep build --only-show-errors --file infra/main.bicep --outfile infra/main.json
```

To deploy a development environment with Azure Developer CLI:

```bash
azd up
azd down
```

`azd` reads `azure.yaml` and the Bicep files under `infra/`.

If your primary Azure region doesn't support `Microsoft.Web/staticSites` (for example `australiaeast`), the infrastructure now keeps the rest of the stack in `AZURE_LOCATION` and automatically places the Static Web App in `eastasia`. The linked backend still points at the Function App's actual region.
Provisioned service resources are also tagged with `azd-service-name`, which `azd deploy` uses to map the `api` and `web` entries from `azure.yaml` onto the deployed Function App and Static Web App.

## GitHub Actions configuration

The following repository secrets are required:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_STATIC_WEB_APPS_API_TOKEN`

The following repository variables are required:

- `AZURE_ENV_NAME`
- `AZURE_LOCATION`
- `AZURE_STATIC_WEB_APP_LOCATION` (optional override when you want the Static Web App in a specific supported region)
- `AZURE_RESOURCE_GROUP`
- `AZURE_FUNCTION_APP_NAME`
- `FRONTDOOR_CUSTOM_DOMAIN` (set to a real delegated host name such as `cdn.yourdomain.com` to enable the managed-cert custom domain; `.example.com` placeholders keep Front Door on the default hostname only)

## Deployment workflows

- `validate`: runs on pull requests and executes the shared `build`, `lint`, and `test` scripts for `web` and `api`
- `deploy-infra`: deploys `infra/main.bicep` to the configured resource group on `main`
- `deploy-api`: builds and deploys the Functions app on `main`
- `deploy-web`: builds and deploys the Static Web App on `main`

The Functions app's managed identity also needs Cosmos DB data-plane access to the
`users` container because authenticated HTTP middleware resolves user profiles from
that store.
For the Sprint 3 media upload pipeline, the Functions app also needs:

- Storage Blob Data Contributor on the media storage account so `POST /api/media/upload-url` can request user delegation keys with managed identity
- `BLOB_SERVICE_URL` set to the Blob service endpoint, for example `https://<account>.blob.core.windows.net`
- `MEDIA_BASE_URL` set to the eventual public media host when Front Door/CDN is in front of Blob Storage
- Optional container overrides via `MEDIA_IMAGES_CONTAINER_NAME`, `MEDIA_GIF_CONTAINER_NAME`, `MEDIA_AUDIO_CONTAINER_NAME`, and `MEDIA_VIDEO_CONTAINER_NAME`
- Optional `MEDIA_UPLOAD_SAS_TTL_MINUTES` between `1` and `15`; the default is `15`

## Front Door media delivery

The infrastructure deployment now attaches a Front Door ruleset to the storage route:

- `/images/`, `/video/`, `/audio/`, and `/gif/` paths cache for `7` days
- `/avatars/` paths cache for `5` minutes
- query strings are ignored for cache key generation

When `FRONTDOOR_CUSTOM_DOMAIN` is set to a real host name, the deployment also creates
the Front Door custom domain with a Microsoft-managed certificate. The deployment
outputs include:

- `frontDoorCustomDomainValidationDnsTxtRecordName`
- `frontDoorCustomDomainValidationDnsTxtRecordValue`
- `frontDoorCustomDomainValidationExpiry`

Create the emitted DNS TXT validation record and point the hostname at the emitted
`frontDoorHostName` CNAME before expecting the custom domain certificate to become
active.

# Deployment Guide

## Scope

Sprint 0 provisions the Azure and GitHub scaffolding required to start feature delivery:

- Azure Static Web Apps (Standard)
- Azure Functions (Flex Consumption)
- Azure Cosmos DB for NoSQL + `acn` database
- Azure Storage account + placeholder blob containers
- Azure AI Search (Basic)
- Azure Front Door (Standard) placeholder
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
- `FRONTDOOR_CUSTOM_DOMAIN` (placeholder or real host name)

## Deployment workflows

- `validate`: runs on pull requests and executes the shared `build`, `lint`, and `test` scripts for `web` and `api`
- `deploy-infra`: deploys `infra/main.bicep` to the configured resource group on `main`
- `deploy-api`: builds and deploys the Functions app on `main`
- `deploy-web`: builds and deploys the Static Web App on `main`

The Functions app's managed identity also needs Cosmos DB data-plane access to the
`users` container because authenticated HTTP middleware resolves user profiles from
that store.

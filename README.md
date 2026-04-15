# ArtificialContact

ArtificialContact is an Azure-native social network for AI practitioners. This repository currently contains the Sprint 0 foundations needed to start feature work: a Vite + React SPA in [`web`](./web), an Azure Functions API in [`api`](./api), and Bicep + `azd` infrastructure in [`infra`](./infra).

## Repository layout

- `web/`: React 19, TypeScript, Vite, Tailwind CSS v4.1, Vitest
- `api/`: Azure Functions (Node 20, TypeScript) with `/api/health`, `/api/users/{handle}`, and the `usersByHandle` change-feed worker
- `infra/`: Bicep modules and `azure.yaml` orchestration for Azure Developer CLI
- `docs/`: requirements, technical design, deployment, and testing documentation

## Quick start

```bash
npm install
npm run build
npm run lint
npm run test
```

## Milestone 1 deliverables

- Monorepo scaffold for `web/`, `api/`, and `infra/`
- `/api/health` returns build metadata, region information, and a Cosmos ping result
- Application Insights wiring for the SPA and Functions
- GitHub Actions for validation and deployment
- Repo governance files: PR template and CODEOWNERS
- Azure deployment model for Static Web Apps, Functions Flex Consumption, Cosmos DB, Storage, AI Search, Key Vault, App Insights, Log Analytics, and Front Door

See [`docs/deployment.md`](./docs/deployment.md) and [`docs/testing.md`](./docs/testing.md) for the operational details.

import { CosmosClient, type Container } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";

import type {
  ExistingMirrorRecord,
  UsersByHandleMirrorDocument,
  UsersByHandleMirrorStore
} from "./usersByHandleMirror";

const DEFAULT_DATABASE_NAME = "acn";
const DEFAULT_USERS_BY_HANDLE_CONTAINER_NAME = "usersByHandle";

type CosmosLikeError = Error & {
  code?: number | string;
  statusCode?: number;
};

function isNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const cosmosError = error as CosmosLikeError;
  return cosmosError.statusCode === 404 || cosmosError.code === 404;
}

function createCosmosClientFromEnvironment(): CosmosClient {
  const endpoint = process.env.COSMOS_ENDPOINT;
  if (endpoint) {
    return new CosmosClient({
      endpoint,
      aadCredentials: new DefaultAzureCredential()
    });
  }

  const connectionString = process.env.COSMOS_CONNECTION;
  if (connectionString) {
    return new CosmosClient(connectionString);
  }

  throw new Error("Set COSMOS_ENDPOINT or COSMOS_CONNECTION before running usersByHandleMirrorFn.");
}

export class CosmosUsersByHandleMirrorStore implements UsersByHandleMirrorStore {
  constructor(private readonly container: Container) {}

  static fromEnvironment(client?: CosmosClient): CosmosUsersByHandleMirrorStore {
    const resolvedClient = client ?? createCosmosClientFromEnvironment();
    const databaseName = process.env.COSMOS_DATABASE_NAME ?? DEFAULT_DATABASE_NAME;
    const containerName =
      process.env.USERS_BY_HANDLE_CONTAINER_NAME ?? DEFAULT_USERS_BY_HANDLE_CONTAINER_NAME;

    return new CosmosUsersByHandleMirrorStore(
      resolvedClient.database(databaseName).container(containerName)
    );
  }

  async getByHandle(handle: string): Promise<ExistingMirrorRecord | null> {
    try {
      const { resource } = await this.container
        .item(handle, handle)
        .read<ExistingMirrorRecord>();

      return resource ?? null;
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }

      throw error;
    }
  }

  async listByUserId(userId: string): Promise<ExistingMirrorRecord[]> {
    const { resources } = await this.container.items
      .query<ExistingMirrorRecord>({
        query: "SELECT c.id, c.handle, c.userId FROM c WHERE c.userId = @userId",
        parameters: [{ name: "@userId", value: userId }]
      })
      .fetchAll();

    return resources ?? [];
  }

  async upsert(document: UsersByHandleMirrorDocument): Promise<void> {
    await this.container.items.upsert(document);
  }

  async delete(handle: string): Promise<void> {
    try {
      await this.container.item(handle, handle).delete();
    } catch (error) {
      if (isNotFound(error)) {
        return;
      }

      throw error;
    }
  }
}

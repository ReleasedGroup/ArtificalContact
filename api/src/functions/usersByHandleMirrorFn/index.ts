import { CosmosUsersByHandleMirrorStore } from "../../cosmosUsersByHandleMirrorStore";
import { syncUsersByHandleBatch, type LoggerLike, type UserDocument } from "../../usersByHandleMirror";

type LogMethod = (...args: unknown[]) => void;

type AzureFunctionLog =
  | (LogMethod & {
      info?: LogMethod;
      warn?: LogMethod;
      error?: LogMethod;
    })
  | undefined;

interface FunctionContextLike {
  log?: AzureFunctionLog;
}

function resolveLogger(log: AzureFunctionLog): LoggerLike {
  const fallback: LogMethod = typeof log === "function" ? log : console.log;
  const info = typeof log?.info === "function" ? log.info.bind(log) : fallback;
  const warn = typeof log?.warn === "function" ? log.warn.bind(log) : fallback;
  const error = typeof log?.error === "function" ? log.error.bind(log) : fallback;

  return { info, warn, error };
}

let cachedStore: CosmosUsersByHandleMirrorStore | undefined;

function getStore(): CosmosUsersByHandleMirrorStore {
  cachedStore ??= CosmosUsersByHandleMirrorStore.fromEnvironment();
  return cachedStore;
}

export async function usersByHandleMirrorFn(
  context: FunctionContextLike,
  documents: UserDocument[] = []
): Promise<void> {
  await syncUsersByHandleBatch(documents, getStore(), resolveLogger(context.log));
}

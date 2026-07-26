export type RuntimeNamespace = 'variable' | 'objectState' | 'scope' | 'execution' | (string & {})
export type RuntimeOrigin = string | symbol

export interface RuntimeKey {
  scope: string
  namespace: RuntimeNamespace
  name: string
}

export type RuntimeStatus = 'idle' | 'pending' | 'ready' | 'error'
export type FetchStatus = 'idle' | 'fetching' | 'paused'

export interface RuntimeSnapshot<T = unknown> {
  status: RuntimeStatus
  value?: T
  error?: unknown
  revision: number
  updatedAt: number
  epoch?: number
  fetchStatus?: FetchStatus
  isStale?: boolean
}

export type RuntimeSnapshotUpdate<T = unknown> = Omit<RuntimeSnapshot<T>, 'revision' | 'updatedAt'>

export type RuntimeSelector =
  | { kind: 'key'; key: RuntimeKey }
  | { kind: 'namespace'; namespace: RuntimeNamespace; scope?: string }

export interface RuntimeChange {
  key: RuntimeKey
  snapshot?: RuntimeSnapshot
  origin?: RuntimeOrigin
}

export interface RuntimeMutationOptions {
  origin?: RuntimeOrigin
}

export interface RuntimeStore {
  read(key: RuntimeKey): RuntimeSnapshot | undefined
  publish(key: RuntimeKey, update: RuntimeSnapshotUpdate, options?: RuntimeMutationOptions): RuntimeSnapshot
  remove(key: RuntimeKey, options?: RuntimeMutationOptions): void
  subscribe(selector: RuntimeSelector, listener: (change: RuntimeChange) => void): () => void
}

export const runtimeKeys = {
  variable: (name: string, scope = 'document'): RuntimeKey => ({ scope, namespace: 'variable', name }),
  objectState: (name: string, scope = 'document'): RuntimeKey => ({ scope, namespace: 'objectState', name }),
  scope: (name: string, scope = 'document'): RuntimeKey => ({ scope, namespace: 'scope', name }),
  execution: (name: string, scope = 'document'): RuntimeKey => ({ scope, namespace: 'execution', name }),
}

function keyId(key: RuntimeKey): string {
  return `${key.scope}\u0000${key.namespace}\u0000${key.name}`
}

function matches(selector: RuntimeSelector, key: RuntimeKey): boolean {
  if (selector.kind === 'namespace') {
    return selector.namespace === key.namespace && (selector.scope === undefined || selector.scope === key.scope)
  }
  return selector.key.scope === key.scope &&
    selector.key.namespace === key.namespace &&
    selector.key.name === key.name
}

export function createMemoryRuntimeStore(): RuntimeStore {
  const snapshots = new Map<string, RuntimeSnapshot>()
  const listeners = new Set<{ selector: RuntimeSelector; listener: (change: RuntimeChange) => void }>()
  let revision = 0

  const notify = (change: RuntimeChange) => {
    for (const entry of listeners) {
      if (matches(entry.selector, change.key)) entry.listener(change)
    }
  }

  return {
    read(key) {
      return snapshots.get(keyId(key))
    },
    publish(key, update, options) {
      const snapshot: RuntimeSnapshot = {
        ...update,
        revision: ++revision,
        updatedAt: Date.now(),
      }
      snapshots.set(keyId(key), snapshot)
      notify({ key, snapshot, origin: options?.origin })
      return snapshot
    },
    remove(key, options) {
      snapshots.delete(keyId(key))
      revision++
      notify({ key, origin: options?.origin })
    },
    subscribe(selector, listener) {
      const entry = { selector, listener }
      listeners.add(entry)
      return () => listeners.delete(entry)
    },
  }
}

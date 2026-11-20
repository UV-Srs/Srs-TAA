import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { OfflineMutation, InspectionBatch, CellResponse } from './types';

interface TAAInspectionDB extends DBSchema {
  cells: {
    key: string; // `${batch_id}_${item_id}_${column_key}`
    value: CellResponse;
  };
  sync_queue: {
    key: string; // client_mutation_id
    value: OfflineMutation;
  };
  cached_batches: {
    key: number; // batch_id
    value: InspectionBatch;
  };
}

const DB_NAME = 'taa_inspection_offline_db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<TAAInspectionDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<TAAInspectionDB>> {
  if (!dbPromise) {
    dbPromise = openDB<TAAInspectionDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('cells')) {
          db.createObjectStore('cells');
        }
        if (!db.objectStoreNames.contains('sync_queue')) {
          db.createObjectStore('sync_queue');
        }
        if (!db.objectStoreNames.contains('cached_batches')) {
          db.createObjectStore('cached_batches');
        }
      },
    });
  }
  return dbPromise;
}

export async function saveCellOffline(mutation: OfflineMutation, isWithinSpec: boolean): Promise<void> {
  const db = await getDB();
  const cellKey = `${mutation.batch_id}_${mutation.item_id}_${mutation.column_key}`;
  
  // Store in active cells
  await db.put('cells', {
    batch_id: mutation.batch_id,
    item_id: mutation.item_id,
    column_key: mutation.column_key,
    cell_value: mutation.cell_value,
    is_within_spec: isWithinSpec,
    checker_initials: mutation.checker_initials,
    client_mutation_id: mutation.client_mutation_id,
    updated_at: mutation.timestamp
  }, cellKey);

  // Queue for background server sync
  await db.put('sync_queue', mutation, mutation.client_mutation_id);
}

export async function getOfflineCellsForBatch(batchId: number): Promise<CellResponse[]> {
  const db = await getDB();
  const allCells = await db.getAll('cells');
  return allCells.filter(c => c.batch_id === batchId);
}

export async function getQueuedMutations(): Promise<OfflineMutation[]> {
  const db = await getDB();
  return db.getAll('sync_queue');
}

export async function removeQueuedMutations(mutationIds: string[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('sync_queue', 'readwrite');
  for (const id of mutationIds) {
    await tx.store.delete(id);
  }
  await tx.done;
}

export async function cacheBatchOffline(batch: InspectionBatch): Promise<void> {
  const db = await getDB();
  await db.put('cached_batches', batch, batch.batch_id);
}

export async function getCachedBatchOffline(batchId: number): Promise<InspectionBatch | undefined> {
  const db = await getDB();
  return db.get('cached_batches', batchId);
}

/**
 * Sim worker entry: a thin shim around SimHost (src/worker/host.ts).
 * Spawned by src/platform/client.ts; protocol in src/contracts/sim-api.ts (ToWorker/FromWorker).
 */
/// <reference lib="webworker" />
import type { FromWorker, ToWorker } from '@contracts/sim-api';
import { runAiTurn } from '../ai';
import { loadContent } from '../content';
import { createIdbStore, Saves } from '../platform/saves';
import { createBroadcastTabChannel } from '../platform/tab-guard';
import { sim } from '../sim';
import { SimHost } from './host';

const scope = self as unknown as DedicatedWorkerGlobalScope;

const host = new SimHost({
  sim,
  runAiTurn,
  // Lazy: a content parse error becomes an `error` message on first use.
  content: loadContent,
  saves: new Saves(createIdbStore()),
  post: (msg: FromWorker) => scope.postMessage(msg),
  // Tells an older tab at once that this one took over the autosaves (src/platform/tab-guard.ts).
  tabs: createBroadcastTabChannel(),
});

scope.onmessage = (e: MessageEvent<ToWorker>) => {
  void host.receive(e.data);
};

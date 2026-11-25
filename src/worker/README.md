# Sim worker

Workstream 6. Web Worker entry (`sim.worker.ts`): receives `ToWorker` messages, calls the sim,
posts `FromWorker` messages with the new state and events. Also runs AI turns.

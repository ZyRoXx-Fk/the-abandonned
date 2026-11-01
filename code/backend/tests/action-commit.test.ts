import { actionCommitContracts } from './helpers/action-commit-contract.js';
import { createRelayMemory } from './helpers/relay-memory.js';
actionCommitContracts('memory', async () => createRelayMemory());

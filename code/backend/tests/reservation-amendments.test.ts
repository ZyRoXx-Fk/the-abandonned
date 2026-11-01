import { amendmentContracts } from './helpers/reservation-amendment-contract.js';
import { createRelayMemory } from './helpers/relay-memory.js';
amendmentContracts('memory', async () => createRelayMemory());

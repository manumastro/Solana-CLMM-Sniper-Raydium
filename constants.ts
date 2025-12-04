import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import dotenv from 'dotenv';
dotenv.config();

const RPC_ENDPOINT = process.env.RPC_ENDPOINT;
const RPC_WEBSOCKET_ENDPOINT =
  process.env.RPC_WEBSOCKET_ENDPOINT;

export const solanaConnection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
});

export const rayFee = new PublicKey(
  '7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5'
);

export const RAYDIUM_CPMM_PROGRAM_ID = new PublicKey(
  'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C'
);

export const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey(
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK'
);


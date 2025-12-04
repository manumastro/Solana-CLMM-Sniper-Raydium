import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';
import chalk from 'chalk';
import { PaperTrader, PoolData } from './paperTrader';

dotenv.config();

const CLMM_PROGRAM_ID = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');

const QUOTE_TOKENS = new Set([
    'So11111111111111111111111111111111111111112', // SOL
]);

async function monitorClmmPools(connection: Connection) {
  console.log(chalk.green(`🟢 MONITOR "HYBRID" ATTIVO (Logs + Raw Tx)`));
  console.log(chalk.gray(`   Target Program: ${CLMM_PROGRAM_ID.toString()}`));

  connection.onLogs(
    CLMM_PROGRAM_ID,
    async ({ logs, err, signature }) => {
      if (err) return;

      const isCreation = logs.some(log => 
          log.includes('Instruction: CreatePool') || 
          log.includes('Instruction: create_pool')
      );

      if (isCreation) {
        console.log(chalk.yellow(`⚡ Rilevata Creazione Pool! Sig: ${signature}`));
        // Avviamo il processamento
        processNewPoolRaw(connection, signature);
      }
    },
    'confirmed'
  );
}

// Funzione Helper per riprovare la fetch se il nodo è lento (Propagation Delay)
async function fetchTransactionWithRetry(connection: Connection, signature: string, maxRetries = 5) {
    for (let i = 0; i < maxRetries; i++) {
        const tx = await connection.getTransaction(signature, {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed'
        });
        if (tx) return tx;
    }
    return null;
}

async function processNewPoolRaw(connection: Connection, signature: string) {
    try {
        // 1. FETCH CON RETRY (Fondamentale per i logs stream)
        const tx = await fetchTransactionWithRetry(connection, signature);

        if (!tx || !tx.transaction || !tx.transaction.message || !tx.meta) {
            console.log(chalk.red("Tx non trovata o incompleta dopo i retry."));
            return;
        }

        // 2. RISOLUZIONE ACCOUNT (LA FIX È QUI) 🛠️
        // Per le transazioni V0, getAccountKeys ha bisogno dei loadedAddresses dai metadata
        const accountKeys = tx.transaction.message.getAccountKeys({
            accountKeysFromLookups: tx.meta.loadedAddresses
        });
        
        // 3. TROVARE L'ISTRUZIONE CLMM
        const instructions = tx.transaction.message.compiledInstructions;
        const clmmInstruction = instructions.find(ix => {
            const programId = accountKeys.get(ix.programIdIndex);
            return programId?.equals(CLMM_PROGRAM_ID);
        });

        if (!clmmInstruction) return;

        // 4. ESTRAZIONE INDICI
        const accountsIndices = clmmInstruction.accountKeyIndexes;
        
        // Raydium CLMM CreatePool Accounts (Indices):
        // 0: PoolCreator, 1: AmmConfig, 2: PoolState
        // 3: TokenMint0, 4: TokenMint1
        // 5: TokenVault0, 6: TokenVault1
        if (accountsIndices.length < 7) return;

        const mint0 = accountKeys.get(accountsIndices[3])?.toString();
        const mint1 = accountKeys.get(accountsIndices[4])?.toString();
        const vault0 = accountKeys.get(accountsIndices[5])?.toString();
        const vault1 = accountKeys.get(accountsIndices[6])?.toString();

        if (mint0 && mint1 && vault0 && vault1) {
            identifyToken(mint0, mint1, vault0, vault1, connection);
        }

    } catch (e) {
        console.error(chalk.red(`Errore Raw Parsing: ${e}`));
    }
}

function identifyToken(mint0: string, mint1: string, vault0: string, vault1: string, connection: Connection) {
    let tokenAddress = "";
    let quoteAddress = "";

    if (QUOTE_TOKENS.has(mint0)) {
        quoteAddress = mint0;
        tokenAddress = mint1;
    } else if (QUOTE_TOKENS.has(mint1)) {
        quoteAddress = mint1;
        tokenAddress = mint0;
    } else {
        return; 
    }

    console.log(chalk.cyan('\n' + '='.repeat(50)));
    console.log(chalk.magenta.bold(`🚀 NUOVA POOL CLMM (RAW DETECT)`));
    console.log(chalk.white(`   Token: ${tokenAddress}`));
    console.log(chalk.gray(`   Quote: ${quoteAddress}`));
    console.log(chalk.blue(`   Dex:   https://dexscreener.com/solana/${tokenAddress}`));
    console.log(chalk.cyan('='.repeat(50)));

    if (quoteAddress) {
        const paperTrader = new PaperTrader(connection);
        const poolData: PoolData = {
            baseMint: tokenAddress,
            quoteMint: quoteAddress,
            baseVault: (tokenAddress === mint0) ? vault0 : vault1, 
            quoteVault: (quoteAddress === mint0) ? vault0 : vault1 
        };
        
        paperTrader.startTracking(poolData, false).catch(err => {
            console.error(chalk.red(`Errore Trader: ${err}`));
        });
    }
}

const solanaConnection = new Connection(process.env.RPC_ENDPOINT!, {
    wsEndpoint: process.env.RPC_WEBSOCKET_ENDPOINT,
    commitment: 'confirmed'
});

monitorClmmPools(solanaConnection);
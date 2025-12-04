import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';
import chalk from 'chalk';
import { PaperTrader, PoolData } from './paperTrader';

dotenv.config();

const CLMM_PROGRAM_ID = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');

const QUOTE_TOKENS = new Set([
    'So11111111111111111111111111111111111111112', // SOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'  // USDT
]);

async function monitorClmmPools(connection: Connection) {
  console.log(chalk.green(`🟢 MONITOR "HYBRID" ATTIVO (Logs + Raw Tx)`));
  console.log(chalk.gray(`   Target Program: ${CLMM_PROGRAM_ID.toString()}`));

  connection.onLogs(
    CLMM_PROGRAM_ID,
    async ({ logs, err, signature }) => {
      if (err) return;

      // FILTRO CHIRURGICO: Solo istruzioni di creazione
      const isCreation = logs.some(log => 
          log.includes('Instruction: CreatePool') || 
          log.includes('Instruction: create_pool')
      );

      if (isCreation) {
        console.log(chalk.yellow(`⚡ Rilevata Creazione Pool! Fetching Raw Tx...`));
        processNewPoolRaw(connection, signature);
      }
    },
    'confirmed'
  );
}

// Funzione Ottimizzata: Usa getTransaction (Raw) invece di getParsedTransaction
async function processNewPoolRaw(connection: Connection, signature: string) {
    try {
        // 1. FETCH PIÙ LEGGERO
        // Usiamo maxSupportedTransactionVersion: 0 per supportare Look-Up Tables (LUT)
        const tx = await connection.getTransaction(signature, {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed'
        });

        if (!tx || !tx.transaction || !tx.transaction.message) return;

        // 2. RISOLUZIONE ACCOUNT (La parte difficile del Raw)
        // Dobbiamo ricostruire l'array completo degli account combinando staticKeys e loadedAddresses (LUT)
        const accountKeys = tx.transaction.message.getAccountKeys();
        
        // 3. TROVARE L'ISTRUZIONE CLMM
        // Invece di cercare per stringa, cerchiamo l'istruzione che invoca il Program ID
        const instructions = tx.transaction.message.compiledInstructions;
        
        const clmmInstruction = instructions.find(ix => {
            const programId = accountKeys.get(ix.programIdIndex);
            return programId?.equals(CLMM_PROGRAM_ID);
        });

        if (!clmmInstruction) return;

        // 4. ESTRAZIONE DEGLI INDICI (Mapping Deterministico)
        // L'ordine degli account in 'CreatePool' è fisso nell'istruzione:
        // Index 3: Mint 0
        // Index 4: Mint 1
        // Index 5: Vault 0
        // Index 6: Vault 1
        // (Nota: Gli indici nell'array `accounts` dell'istruzione puntano all'array globale `accountKeys`)
        
        const accountsIndices = clmmInstruction.accountKeyIndexes;
        
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
        // Coppia ignorata (es. USDC/USDT)
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
    commitment: 'confirmed' // Consigliato 'confirmed' per la fetch della TX completa
});

monitorClmmPools(solanaConnection);
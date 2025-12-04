import { Connection, PublicKey, ParsedTransactionWithMeta } from '@solana/web3.js';
import dotenv from 'dotenv';
import chalk from 'chalk';
import { PaperTrader, PoolData } from './paperTrader';

dotenv.config();

const CLMM_PROGRAM_ID = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');

// Mints da ignorare (SOL e USDC per trovare la "gem")
const QUOTE_TOKENS = new Set([
    'So11111111111111111111111111111111111111112', // SOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'  // USDT
]);

async function monitorClmmPools(connection: Connection) {
  console.log(chalk.green(`🟢 Sniping Raydium CLMM su: ${CLMM_PROGRAM_ID.toString()}`));

  connection.onLogs(
    CLMM_PROGRAM_ID,
    async ({ logs, err, signature }) => {
      if (err) return;

      // Anchor solitamente logga "Instruction: CreatePool" (PascalCase) o "Instruction: create_pool"
      // Controlliamo entrambi per sicurezza, o usiamo una Regex flessibile.
      const isCreation = logs.some(log => 
          log.includes('Instruction: CreatePool') || 
          log.includes('Instruction: create_pool')
      );

      if (isCreation) {
        console.log(chalk.yellow(`⚡ Rilevata Creazione Pool CLMM! Sig: ${signature}`));
        processNewPool(connection, signature);
      }
    },
    'confirmed'
  );
}

async function processNewPool(connection: Connection, signature: string) {
    try {
        // Nota: Per MEV reale, qui useresti getTransaction (binary) e decodificheresti manualmente 
        // per risparmiare i millisecondi del parsing JSON del nodo.
        // Manteniamo 'parsed' per leggibilità, ma imposta maxSupportedTransactionVersion
        const tx = await connection.getParsedTransaction(signature, {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed'
        });

        if (!tx || !tx.transaction || !tx.transaction.message) return;

        // Cerchiamo l'istruzione specifica all'interno della transazione
        const instructions = tx.transaction.message.instructions;
        
        // Troviamo l'istruzione che appartiene al programma CLMM
        // In una parsed transaction, se l'IDL non è noto al nodo, potrebbe apparire come 'PartiallyDecoded'
        // Se è 'ParsedInstruction', solana web3 ha fatto il lavoro per noi, ma spesso su programmi custom è 'PartiallyDecoded'
        const createPoolIx = instructions.find(ix => 
            ix.programId.equals(CLMM_PROGRAM_ID)
        );

        if (!createPoolIx) return;

        let mint0 = "";
        let mint1 = "";
        let vault0 = "";
        let vault1 = "";

        // STRATEGIA DETERMINISTICA:
        // L'ordine degli account in 'CreatePool' è fisso.
        // Indice 3 = Token Mint 0
        // Indice 4 = Token Mint 1
        // Indice 5 = Token Vault 0
        // Indice 6 = Token Vault 1
        
        // Se l'istruzione è "PartiallyDecoded" (più probabile per programmi complessi senza IDL pubblico sul nodo)
        if ('accounts' in createPoolIx) {
            const accounts = createPoolIx.accounts; // Array di PublicKeys
            if (accounts.length >= 7) {
                mint0 = accounts[3].toString();
                mint1 = accounts[4].toString();
                vault0 = accounts[5].toString();
                vault1 = accounts[6].toString();
            }
        } 
        // Se il nodo RPC è abbastanza intelligente da averla parsata (raro per CLMM real-time)
        else if ('parsed' in createPoolIx) {
            const info = createPoolIx.parsed.info;
            // Qui dipenderebbe da come il nodo mappa i nomi dei campi (spesso mint0, mint1)
            mint0 = info.mint0 || info.tokenMint0;
            mint1 = info.mint1 || info.tokenMint1;
            // Vaults might not be in parsed info easily without checking structure
        }

        if (mint0 && mint1 && vault0 && vault1) {
            identifyToken(mint0, mint1, vault0, vault1, signature, connection);
        }

    } catch (e) {
        console.error(chalk.red(`Errore processing tx: ${e}`));
    }
}

function identifyToken(mint0: string, mint1: string, vault0: string, vault1: string, sig: string, connection: Connection) {
    // Logica per capire qual è il token "pump" e quale il quote (SOL/USDC)
    let tokenAddress = "";
    let quoteAddress = "";

    if (QUOTE_TOKENS.has(mint0)) {
        quoteAddress = mint0;
        tokenAddress = mint1;
    } else if (QUOTE_TOKENS.has(mint1)) {
        quoteAddress = mint1;
        tokenAddress = mint0;
    } else {
        // Coppia esotica (es. PIPPO/PLUTO) - Raro ma possibile
        tokenAddress = `${mint0} / ${mint1}`;
    }

    console.log(chalk.cyan('\n' + '='.repeat(50)));
    console.log(chalk.magenta.bold(`🚀 NUOVA POOL CLMM IDENTIFICATA`));
    console.log(chalk.white(`Token: ${chalk.bold(tokenAddress)}`));
    console.log(chalk.gray(`Quote: ${quoteAddress}`));
    console.log(chalk.blue(`Dex: https://dexscreener.com/solana/${tokenAddress}`));
    console.log(chalk.cyan('='.repeat(50)));

    if (quoteAddress) {
        const paperTrader = new PaperTrader(connection);
        const poolData: PoolData = {
            baseMint: tokenAddress,
            quoteMint: quoteAddress,
            baseVault: (tokenAddress === mint0) ? vault0 : vault1, // Token Vault
            quoteVault: (quoteAddress === mint0) ? vault0 : vault1 // Quote Vault (SOL/USDC)
        };

        // inverted=false because we mapped baseVault to Token and quoteVault to Quote(SOL)
        // PaperTrader logic:
        // let solAmount = inverted ? baseBal : quoteBal;
        // let tokenAmount = inverted ? quoteBal : baseBal;
        // If inverted=false: solAmount = quoteBal (QuoteVault), tokenAmount = baseBal (TokenVault). Correct.
        
        paperTrader.startTracking(poolData, false).catch(err => {
            console.error(chalk.red(`Errore avvio Paper Trader: ${err}`));
        });
    }
}

const solanaConnection = new Connection(process.env.RPC_ENDPOINT!, {
    wsEndpoint: process.env.RPC_WEBSOCKET_ENDPOINT,
    commitment: 'confirmed'
});
monitorClmmPools(solanaConnection);
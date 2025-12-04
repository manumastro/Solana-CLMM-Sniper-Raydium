import { Connection, PublicKey } from '@solana/web3.js';
import chalk from 'chalk';

export interface PoolData {
    baseVault: string;
    quoteVault: string;
    baseMint: string;
    quoteMint: string;
}

export class PaperTrader {
    private connection: Connection;
    private isTracking: boolean = false;
    
    // Dati Prezzo
    private initialPrice: number = 0;
    private maxPrice: number = 0;
    private startTime: number = 0;

    // CONFIGURAZIONE STRATEGIA (SCALPING)
    private readonly TAKE_PROFIT = 5; // Vendi a +5%
    private readonly HARD_STOP_LOSS = 10; // Vendi a -10% (Protezione)
    
    // SIMULAZIONE SOLDI (Per calcolo profitto)
    private readonly INVESTMENT_SOL = 1.0; // Simuliamo di investire 1 SOL

    constructor(connection: Connection) {
        this.connection = connection;
    }

    public async startTracking(
        poolData: PoolData,
        inverted: boolean
    ) {
        console.log(chalk.cyan(`\n📜 AVVIO PAPER TRADER: SCALP MODE (Fixed TP)`));
        console.log(chalk.gray(`   Take Profit: +${this.TAKE_PROFIT}% | Stop Loss: -${this.HARD_STOP_LOSS}%`));
        console.log(chalk.gray(`   Simulazione su size: ${this.INVESTMENT_SOL} SOL`));
        
        this.isTracking = true;
        this.startTime = Date.now();

        const baseVault = new PublicKey(poolData.baseVault);
        const quoteVault = new PublicKey(poolData.quoteVault);

        while (this.isTracking) {
            try {
                // 1. Fetch Dati On-Chain
                const baseBal = await this.connection.getTokenAccountBalance(baseVault, 'confirmed');
                const quoteBal = await this.connection.getTokenAccountBalance(quoteVault, 'confirmed');

                if (!baseBal.value.uiAmount || !quoteBal.value.uiAmount) {
                    await new Promise(r => setTimeout(r, 1000));
                    continue;
                }

                // 2. Calcolo Prezzo (SOL per Token)
                let solAmount = inverted ? baseBal.value.uiAmount : quoteBal.value.uiAmount;
                let tokenAmount = inverted ? quoteBal.value.uiAmount : baseBal.value.uiAmount;

                if (tokenAmount === 0 || solAmount === 0) continue;

                let currentPrice = solAmount / tokenAmount;

                // 3. INIZIALIZZAZIONE (Primo Tick)
                if (this.initialPrice === 0) {
                    this.initialPrice = currentPrice;
                    this.maxPrice = currentPrice;
                    
                    console.log(chalk.greenBright.bold(`\n🔫 BUY EXECUTED`));
                    console.log(chalk.white(`   Entry Price: ${chalk.yellow(this.initialPrice.toFixed(9))} SOL`));
                    console.log(chalk.gray(`   Liquidity:   ${solAmount.toFixed(2)} SOL`));
                    console.log('-'.repeat(50));
                }

                // 4. LOGICA STATICA
                if (currentPrice > this.maxPrice) this.maxPrice = currentPrice;

                // Calcolo Target Price (Dove vogliamo vendere)
                const targetPrice = this.initialPrice * (1 + (this.TAKE_PROFIT / 100));
                
                // Calcolo PnL attuale
                const pnlPercent = ((currentPrice - this.initialPrice) / this.initialPrice) * 100;
                
                // 5. VISUALIZZAZIONE REAL-TIME
                const elapsed = (Date.now() - this.startTime) / 1000;
                let pnlColor = pnlPercent >= 0 ? chalk.green : chalk.red;
                
                // Formattiamo l'output
                process.stdout.write(
                    `\r ⏱️ ${elapsed.toFixed(0)}s | ` +
                    `Price: ${chalk.white(currentPrice.toFixed(9))} | ` +
                    `Target: ${chalk.cyan(targetPrice.toFixed(9))} | ` +
                    `PnL: ${pnlColor(pnlPercent.toFixed(2) + '%')}`
                );

                // 6. CONTROLLO VENDITA
                
                // Caso A: Take Profit (+5%)
                if (pnlPercent >= this.TAKE_PROFIT) {
                    this.executeSell("TAKE PROFIT", currentPrice, pnlPercent);
                    break;
                }

                // Caso B: Stop Loss (-10%)
                if (pnlPercent <= -this.HARD_STOP_LOSS) {
                    this.executeSell("STOP LOSS", currentPrice, pnlPercent);
                    break;
                }

                await new Promise(r => setTimeout(r, 100)); 

            } catch (e) {
                console.error(chalk.red(`Errore Paper Trader: ${e}`));
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }

    private executeSell(reason: string, price: number, pnlPercent: number) {
        console.log(`\n\n` + '='.repeat(50));
        
        // Calcolo Profitto in SOL
        // Profitto = Investimento * (Percentuale / 100)
        // Esempio: 1 SOL * (5 / 100) = 0.05 SOL
        const profitSol = this.INVESTMENT_SOL * (pnlPercent / 100);

        if (pnlPercent > 0) {
            console.log(chalk.greenBright.bold(`✅ ${reason} HIT!`));
        } else {
            console.log(chalk.redBright.bold(`🛑 ${reason} HIT!`));
        }
        
        console.log(`   Entry Price:    ${this.initialPrice.toFixed(9)}`);
        console.log(`   Exit Price:     ${price.toFixed(9)}`);
        console.log(`   PnL Percent:    ${pnlPercent > 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`);
        console.log(`   --------------------------------`);
        
        if (profitSol > 0) {
             console.log(chalk.green.bold(`   PROFITTO REALE: +${profitSol.toFixed(4)} SOL`));
        } else {
             console.log(chalk.red.bold(`   PERDITA REALE:  ${profitSol.toFixed(4)} SOL`));
        }

        console.log('='.repeat(50) + `\n`);
        this.stop();
    }
    
    public stop() {
        this.isTracking = false;
    }
}
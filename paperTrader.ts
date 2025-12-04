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

    // CONFIGURAZIONE STRATEGIA "MOONSHOT SECURE"
    private readonly TAKE_PROFIT = 10;      // Target ambizioso (+10%)
    private readonly INITIAL_STOP_LOSS = 5; // Stop Loss iniziale (-5%)
    private readonly BREAKEVEN_TRIGGER = 5; // A +5% di profitto, sposta SL a 0%
    
    // STATO DINAMICO
    private currentStopLevel = -5; // Parte da -5, diventerà 0
    private isBreakevenActive = false;

    // SIMULAZIONE SOLDI
    private readonly INVESTMENT_SOL = 1.0; 

    constructor(connection: Connection) {
        this.connection = connection;
    }

    public async startTracking(
        poolData: PoolData,
        inverted: boolean
    ) {
        // Reset stato
        this.currentStopLevel = -this.INITIAL_STOP_LOSS;
        this.isBreakevenActive = false;

        console.log(chalk.cyan(`\n📜 AVVIO PAPER TRADER: BREAKEVEN STRATEGY`));
        console.log(chalk.gray(`   TP: +${this.TAKE_PROFIT}% | Initial SL: -${this.INITIAL_STOP_LOSS}%`));
        console.log(chalk.yellow(`   ⚡ TRIGGER: Se PnL >= +${this.BREAKEVEN_TRIGGER}%, SL diventa 0%`));
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

                // 2. Calcolo Prezzo
                let solAmount = inverted ? baseBal.value.uiAmount : quoteBal.value.uiAmount;
                let tokenAmount = inverted ? quoteBal.value.uiAmount : baseBal.value.uiAmount;

                if (tokenAmount === 0 || solAmount === 0) continue;

                let currentPrice = solAmount / tokenAmount;

                // 3. INIZIALIZZAZIONE
                if (this.initialPrice === 0) {
                    this.initialPrice = currentPrice;
                    this.maxPrice = currentPrice;
                    
                    console.log(chalk.greenBright.bold(`\n🔫 BUY EXECUTED`));
                    console.log(chalk.white(`   Entry Price: ${chalk.yellow(this.initialPrice.toFixed(9))} SOL`));
                    console.log(chalk.gray(`   Liquidity:   ${solAmount.toFixed(2)} SOL`));
                    console.log('-'.repeat(50));
                }

                // 4. LOGICA DI TRADING
                if (currentPrice > this.maxPrice) this.maxPrice = currentPrice;

                // Calcolo PnL attuale
                const pnlPercent = ((currentPrice - this.initialPrice) / this.initialPrice) * 100;

                // --- LOGICA BREAKEVEN ---
                if (!this.isBreakevenActive && pnlPercent >= this.BREAKEVEN_TRIGGER) {
                    this.isBreakevenActive = true;
                    this.currentStopLevel = 0; // Sposta SL a 0
                    console.log(chalk.blueBright.bold(`\n🛡️  SECURIZED! Profit >= ${this.BREAKEVEN_TRIGGER}%. Stop Loss moved to BREAKEVEN (0%).`));
                }

                // 5. VISUALIZZAZIONE
                const elapsed = (Date.now() - this.startTime) / 1000;
                let pnlColor = pnlPercent >= 0 ? chalk.green : chalk.red;
                
                // Formattiamo l'output
                // Mostriamo lo Stop Level attuale (che può cambiare da -5 a 0)
                process.stdout.write(
                    `\r ⏱️ ${elapsed.toFixed(0)}s | ` +
                    `Price: ${chalk.white(currentPrice.toFixed(9))} | ` +
                    `SL Level: ${this.isBreakevenActive ? chalk.cyan('0.00% (BE)') : chalk.red('-5.00%')} | ` +
                    `PnL: ${pnlColor(pnlPercent.toFixed(2) + '%')}`
                );

                // 6. CONTROLLO VENDITA
                
                // Caso A: Take Profit (+40%)
                if (pnlPercent >= this.TAKE_PROFIT) {
                    this.executeSell("MOONSHOT TP", currentPrice, pnlPercent);
                    break;
                }

                // Caso B: Stop Loss Dinamico (o -5% o 0%)
                // Nota: Usiamo < invece di <= per dare un minimo di respiro sullo zero esatto (floating point)
                if (pnlPercent < this.currentStopLevel - 0.01) { 
                    const reason = this.isBreakevenActive ? "BREAKEVEN EXIT" : "STOP LOSS";
                    this.executeSell(reason, currentPrice, pnlPercent);
                    break;
                }

                await new Promise(r => setTimeout(r, 100)); 

            } catch (e) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    }

    private executeSell(reason: string, price: number, pnlPercent: number) {
        console.log(`\n\n` + '='.repeat(50));
        
        const profitSol = this.INVESTMENT_SOL * (pnlPercent / 100);

        if (pnlPercent > 0) {
            console.log(chalk.greenBright.bold(`✅ ${reason} HIT!`));
        } else if (Math.abs(pnlPercent) < 0.1) {
            console.log(chalk.cyan.bold(`🛡️ ${reason} HIT (Safe Exit)!`));
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
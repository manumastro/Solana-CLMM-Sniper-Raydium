import { Connection, PublicKey } from '@solana/web3.js';

export interface PoolData {
    baseVault: string;
    quoteVault: string;
    baseMint: string;
    quoteMint: string;
}

export class PaperTrader {
    private connection: Connection;
    private isTracking: boolean = false;
    private initialPrice: number = 0;
    private maxPrice: number = 0;
    private startTime: number = 0;

    constructor(connection: Connection) {
        this.connection = connection;
    }

    public async startTracking(
        poolData: PoolData,
        inverted: boolean
    ) {
        console.log(`\n   📜 AVVIO PAPER TRADING (Simulazione)...`);
        this.isTracking = true;
        this.startTime = Date.now();

        const baseVault = new PublicKey(poolData.baseVault);
        const quoteVault = new PublicKey(poolData.quoteVault);

        console.log(`   🏦 Base Vault: ${baseVault.toBase58()}`);
        console.log(`   🏦 Quote Vault: ${quoteVault.toBase58()}`);

        // Loop di monitoraggio
        while (this.isTracking) {
            try {
                // Fetch balances
                const baseBal = await this.connection.getTokenAccountBalance(baseVault, 'confirmed');
                const quoteBal = await this.connection.getTokenAccountBalance(quoteVault, 'confirmed');

                if (baseBal.value.uiAmount === null || quoteBal.value.uiAmount === null) {
                    console.log("   ⚠️  Attesa liquidità...");
                    await new Promise(r => setTimeout(r, 1000));
                    continue;
                }

                // Calcolo Prezzo (SOL per Token)
                // inverted = true means base is SOL/Quote, quote is Token
                // inverted = false means quote is SOL/Quote, base is Token
                let solAmount = inverted ? baseBal.value.uiAmount : quoteBal.value.uiAmount;
                let tokenAmount = inverted ? quoteBal.value.uiAmount : baseBal.value.uiAmount;

                if (tokenAmount === 0 || solAmount === 0) {
                     await new Promise(r => setTimeout(r, 1000));
                     continue;
                }

                let price = solAmount / tokenAmount;

                if (this.initialPrice === 0) {
                    this.initialPrice = price;
                    this.maxPrice = price;
                    console.log(`   🟢 BUY SIMULATO @ ${price.toFixed(9)} SOL`);
                    console.log(`   ⏰ Entry Time: ${new Date().toISOString()}`);
                    console.log(`   💧 Liquidity: ${solAmount.toFixed(2)} SOL`);
                }

                // Update stats
                if (price > this.maxPrice) this.maxPrice = price;
                
                const pnl = ((price - this.initialPrice) / this.initialPrice) * 100;
                const elapsed = (Date.now() - this.startTime) / 1000;

                // Log su una riga che si aggiorna (se possibile, altrimenti log normale)
                console.log(`   ⏱️  ${elapsed.toFixed(1)}s | Price: ${price.toFixed(9)} | PnL: ${pnl > 0 ? '+' : ''}${pnl.toFixed(2)}% | Max: +${((this.maxPrice - this.initialPrice)/this.initialPrice * 100).toFixed(2)}%`);

                await new Promise(r => setTimeout(r, 2000)); // Check every 2s

            } catch (e) {
                console.error("   ❌ Errore Paper Trader:", e);
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    }
    
    public stop() {
        this.isTracking = false;
    }
}

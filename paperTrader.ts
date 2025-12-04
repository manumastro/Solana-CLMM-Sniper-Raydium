import { Connection, PublicKey } from '@solana/web3.js';
import Table from 'cli-table3';
import chalk from 'chalk';

export interface PoolData {
    baseVault: string;
    quoteVault: string;
    baseMint: string;
    quoteMint: string;
}

interface TrackingSession {
    id: string;
    token: string;
    isTracking: boolean;
    initialPrice: number;
    currentPrice: number;
    maxPrice: number;
    startTime: number;
    pnl: number;
    maxPnl: number;
    liquidity: number;
}

export class PaperTrader {
    private connection: Connection;
    private activeSessions: Map<string, TrackingSession> = new Map();
    private tableUpdateInterval: NodeJS.Timeout | null = null;

    constructor(connection: Connection) {
        this.connection = connection;
        this.startTableUpdate();
    }

    private startTableUpdate() {
        // Aggiorna la tabella ogni 1 secondo
        this.tableUpdateInterval = setInterval(() => {
            this.printTable();
        }, 1000);
    }

    private printTable() {
        if (this.activeSessions.size === 0) return;

        // Clear console e ristampa la tabella
        console.clear();
        
        const table = new Table({
            head: [
                chalk.cyan('📊 TOKEN'),
                chalk.cyan('ENTRY PRICE'),
                chalk.cyan('CURRENT PRICE'),
                chalk.cyan('📈 MAX PRICE'),
                chalk.cyan('⏱️ ELAPSED'),
                chalk.cyan('💰 PnL'),
                chalk.cyan('📊 MAX PnL'),
                chalk.cyan('💧 LIQ (SOL)')
            ],
            style: {
                head: [],
                border: ['grey'],
                compact: false
            },
            wordWrap: true,
            colWidths: [25, 18, 18, 18, 12, 15, 15, 15]
        });

        this.activeSessions.forEach((session) => {
            if (!session.isTracking) return;

            const elapsed = ((Date.now() - session.startTime) / 1000).toFixed(1);
            const pnlColor = session.pnl > 0 ? chalk.green : session.pnl < 0 ? chalk.red : chalk.white;
            const maxPnlColor = chalk.yellow;

            table.push([
                chalk.bold.cyan(session.token.substring(0, 20)),
                chalk.white(session.initialPrice.toFixed(9)),
                chalk.white(session.currentPrice.toFixed(9)),
                chalk.yellow(session.maxPrice.toFixed(9)),
                chalk.white(elapsed + 's'),
                pnlColor(`${session.pnl > 0 ? '+' : ''}${session.pnl.toFixed(2)}%`),
                maxPnlColor(`+${session.maxPnl.toFixed(2)}%`),
                chalk.blue(session.liquidity.toFixed(2))
            ]);
        });

        console.log('\n' + chalk.bold.magenta('═'.repeat(120)));
        console.log(chalk.bold.magenta('🤖 PARALLEL PAPER TRADING - SIMULAZIONE RAYDIUM CLMM'));
        console.log(chalk.bold.magenta('═'.repeat(120)) + '\n');
        console.log(table.toString());
        console.log('\n' + chalk.bold.magenta('═'.repeat(120)) + '\n');
    }

    public async startTracking(
        poolData: PoolData,
        inverted: boolean
    ) {
        const sessionId = Date.now().toString() + Math.random().toString(36).substring(7);
        const session: TrackingSession = {
            id: sessionId,
            token: poolData.baseMint,
            isTracking: true,
            initialPrice: 0,
            currentPrice: 0,
            maxPrice: 0,
            startTime: Date.now(),
            pnl: 0,
            maxPnl: 0,
            liquidity: 0
        };

        this.activeSessions.set(sessionId, session);

        const baseVault = new PublicKey(poolData.baseVault);
        const quoteVault = new PublicKey(poolData.quoteVault);

        console.log(chalk.green(`✅ Paper Trading avviato per ${poolData.baseMint}`));

        // Loop di monitoraggio (NON blocca altri tracking)
        this.trackingLoop(sessionId, baseVault, quoteVault, inverted, session).catch(err => {
            console.error(chalk.red(`❌ Errore tracking ${sessionId}:`, err));
            session.isTracking = false;
        });
    }

    private async trackingLoop(
        sessionId: string,
        baseVault: PublicKey,
        quoteVault: PublicKey,
        inverted: boolean,
        session: TrackingSession
    ) {
        while (session.isTracking && this.activeSessions.has(sessionId)) {
            try {
                // Fetch balances
                const baseBal = await this.connection.getTokenAccountBalance(baseVault, 'confirmed');
                const quoteBal = await this.connection.getTokenAccountBalance(quoteVault, 'confirmed');

                if (baseBal.value.uiAmount === null || quoteBal.value.uiAmount === null) {
                    await new Promise(r => setTimeout(r, 1000));
                    continue;
                }

                // Calcolo Prezzo (SOL per Token)
                let solAmount = inverted ? baseBal.value.uiAmount : quoteBal.value.uiAmount;
                let tokenAmount = inverted ? quoteBal.value.uiAmount : baseBal.value.uiAmount;

                if (tokenAmount === 0 || solAmount === 0) {
                    await new Promise(r => setTimeout(r, 1000));
                    continue;
                }

                let price = solAmount / tokenAmount;

                if (session.initialPrice === 0) {
                    session.initialPrice = price;
                    session.maxPrice = price;
                    session.liquidity = solAmount;
                }

                // Update stats
                session.currentPrice = price;
                session.liquidity = solAmount;
                
                if (price > session.maxPrice) {
                    session.maxPrice = price;
                }

                session.pnl = ((price - session.initialPrice) / session.initialPrice) * 100;
                session.maxPnl = ((session.maxPrice - session.initialPrice) / session.initialPrice) * 100;

                await new Promise(r => setTimeout(r, 2000)); // Check every 2s

            } catch (e) {
                console.error(chalk.red(`Errore nel fetch balance: ${e}`));
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    }
    
    public stop(sessionId?: string) {
        if (sessionId) {
            const session = this.activeSessions.get(sessionId);
            if (session) {
                session.isTracking = false;
            }
        } else {
            // Stop all sessions
            this.activeSessions.forEach(session => {
                session.isTracking = false;
            });
        }
    }

    public stopAll() {
        if (this.tableUpdateInterval) {
            clearInterval(this.tableUpdateInterval);
        }
        this.stop();
    }

    public getActiveSessions(): Map<string, TrackingSession> {
        return this.activeSessions;
    }
}

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { MuralService } from './mural.service';
import { CONFIG } from './config';

@Injectable()
export class BootstrapService implements OnModuleInit {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(private mural: MuralService) {}

  async onModuleInit() {
    await this.setupAccount();
    await this.setupWebhook();
  }

  private async setupAccount() {
    const accounts = await this.mural.getAccounts();
    let account = accounts.find(
      (a: any) => a.isApiEnabled && a.status === 'ACTIVE',
    );

    if (!account) {
      this.logger.log('No active API-enabled account found, creating one...');
      account = await this.mural.createAccount('Marketplace Account');
      this.logger.log(
        `Created account ${account.id}, waiting for ACTIVE status...`,
      );

      let attempts = 0;
      while (account.status !== 'ACTIVE' && attempts < 30) {
        await new Promise((r) => setTimeout(r, 2000));
        account = await this.mural.getAccount(account.id);
        attempts++;
      }
      if (account.status !== 'ACTIVE') {
        throw new Error('Account did not become ACTIVE in time');
      }
    }

    CONFIG.muralAccountId = account.id;
    CONFIG.depositWalletAddress =
      account.accountDetails?.walletDetails?.walletAddress;
    this.logger.log(
      `Account: ${account.id}, Wallet: ${CONFIG.depositWalletAddress}`,
    );
  }

  private async setupWebhook() {
    const baseUrl = process.env.BASE_URL;
    if (!baseUrl) {
      this.logger.warn('BASE_URL not set -- skipping webhook registration');
      return;
    }

    const webhookUrl = `${baseUrl}/webhooks/mural`;
    const existing = await this.mural.listWebhooks();
    let webhook = existing.find((w: any) => w.url === webhookUrl);

    if (!webhook) {
      this.logger.log(`Registering webhook: ${webhookUrl}`);
      webhook = await this.mural.createWebhook(webhookUrl, [
        'MURAL_ACCOUNT_BALANCE_ACTIVITY',
      ]);
    }

    if (webhook.status !== 'ACTIVE') {
      await this.mural.activateWebhook(webhook.id);
      this.logger.log(`Activated webhook ${webhook.id}`);
    }

    CONFIG.webhookPublicKey = webhook.publicKey;
    this.logger.log('Webhook ready');
  }
}

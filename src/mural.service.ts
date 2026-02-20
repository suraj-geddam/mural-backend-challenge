import { Injectable, Logger } from '@nestjs/common';
import { CONFIG } from './config';

@Injectable()
export class MuralService {
  private readonly logger = new Logger(MuralService.name);

  private headers(includeTransferKey = false): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${CONFIG.MURAL_API_KEY}`,
      'Content-Type': 'application/json',
    };
    if (includeTransferKey) {
      h['transfer-api-key'] = CONFIG.MURAL_TRANSFER_API_KEY;
    }
    return h;
  }

  private async request(
    method: string,
    path: string,
    body?: any,
    transferKey = false,
  ) {
    const url = `${CONFIG.MURAL_API_URL}${path}`;
    this.logger.log(`${method} ${url}`);
    const res = await fetch(url, {
      method,
      headers: this.headers(transferKey),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const error = await res.text();
      this.logger.error(`Mural API error ${res.status}: ${error}`);
      throw new Error(`Mural API ${res.status}: ${error}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // --- Accounts ---
  getAccounts() {
    return this.request('GET', '/api/accounts');
  }
  getAccount(id: string) {
    return this.request('GET', `/api/accounts/${id}`);
  }
  createAccount(name: string) {
    return this.request(
      'POST',
      '/api/accounts',
      {
        name,
        destinationToken: { symbol: 'USDC', blockchain: 'POLYGON' },
      },
      true,
    );
  }

  // --- Payouts ---
  createPayoutRequest(sourceAccountId: string, amountUsdc: number) {
    return this.request('POST', '/api/payouts/payout', {
      sourceAccountId,
      memo: 'Auto-conversion to COP',
      payouts: [
        {
          amount: { tokenAmount: amountUsdc, tokenSymbol: 'USDC' },
          recipientInfo: {
            type: 'individual',
            firstName: CONFIG.MERCHANT_BANK.recipientFirstName,
            lastName: CONFIG.MERCHANT_BANK.recipientLastName,
            email: CONFIG.MERCHANT_BANK.recipientEmail,
            physicalAddress: CONFIG.MERCHANT_BANK.recipientAddress,
          },
          payoutDetails: {
            type: 'fiat',
            bankName: CONFIG.MERCHANT_BANK.bankName,
            bankAccountOwner: CONFIG.MERCHANT_BANK.bankAccountOwner,
            fiatAndRailDetails: CONFIG.MERCHANT_BANK.fiatDetails,
          },
        },
      ],
    });
  }

  executePayoutRequest(payoutRequestId: string) {
    return this.request(
      'POST',
      `/api/payouts/payout/${payoutRequestId}/execute`,
      { exchangeRateToleranceMode: 'FLEXIBLE' },
      true,
    );
  }

  getPayoutRequest(id: string) {
    return this.request('GET', `/api/payouts/payout/${id}`);
  }

  // --- Webhooks ---
  createWebhook(url: string, categories: string[]) {
    return this.request('POST', '/api/webhooks', { url, categories });
  }
  activateWebhook(webhookId: string) {
    return this.request('PATCH', `/api/webhooks/${webhookId}/status`, {
      status: 'ACTIVE',
    });
  }
  listWebhooks() {
    return this.request('GET', '/api/webhooks');
  }
}

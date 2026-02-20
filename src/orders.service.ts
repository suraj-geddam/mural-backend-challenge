import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DatabaseService } from './database.service';
import { MuralService } from './mural.service';
import { CONFIG } from './config';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private db: DatabaseService,
    private mural: MuralService,
  ) {}

  async createOrder(
    customerEmail: string,
    items: { productId: string; quantity: number }[],
  ) {
    if (!items?.length)
      throw new BadRequestException('At least one item required');

    // Validate products and compute total
    let totalUsd = 0;
    const resolvedItems: {
      productId: string;
      quantity: number;
      unitPrice: number;
    }[] = [];

    for (const item of items) {
      const product = (await this.db.getProduct(item.productId)) as any;
      if (!product)
        throw new BadRequestException(`Product ${item.productId} not found`);
      if (item.quantity < 1)
        throw new BadRequestException('Quantity must be >= 1');
      totalUsd += product.price_usd * item.quantity;
      resolvedItems.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: product.price_usd,
      });
    }

    // Round totalUsd to 2 decimal places
    totalUsd = Math.round(totalUsd * 100) / 100;

    // Generate unique USDC amount: last 3 of 6 decimals randomized (0.000001 to 0.000999)
    let uniqueAmount: number;
    let attempts = 0;
    do {
      const fraction = (Math.floor(Math.random() * 999) + 1) / 1_000_000;
      uniqueAmount =
        Math.round((totalUsd + fraction) * 1_000_000) / 1_000_000;
      attempts++;
      if (attempts > 50)
        throw new BadRequestException(
          'Unable to generate unique amount, try again',
        );
    } while (await this.db.isPendingAmountTaken(uniqueAmount));

    const orderId = uuid();
    const order = await this.db.createOrder({
      id: orderId,
      customerEmail,
      totalUsd,
      uniqueAmountUsdc: uniqueAmount,
      depositAddress: CONFIG.depositWalletAddress,
      items: resolvedItems,
    });

    return {
      orderId: order.id,
      status: order.status,
      totalUsd,
      amountUsdc: uniqueAmount,
      depositAddress: CONFIG.depositWalletAddress,
      message: `Send exactly ${uniqueAmount} USDC to ${CONFIG.depositWalletAddress} on Polygon`,
    };
  }

  async getOrder(id: string) {
    return this.db.getOrder(id);
  }

  /** Called by webhook handler when a deposit is detected. */
  async handleDeposit(tokenAmount: number, transactionHash: string) {
    this.logger.log(
      `Deposit detected: ${tokenAmount} USDC, tx: ${transactionHash}`,
    );

    // Deduplicate: skip if this transaction was already processed
    if (transactionHash && await this.db.isDepositTxProcessed(transactionHash)) {
      this.logger.warn(`Duplicate webhook for tx ${transactionHash}, skipping`);
      return null;
    }

    const order = await this.db.findPendingOrderByAmount(tokenAmount);
    if (!order) {
      this.logger.warn(`No pending order found for amount ${tokenAmount}`);
      return null;
    }

    this.logger.log(`Matched deposit to order ${order.id}`);
    await this.db.updateOrderStatus(order.id, 'paid');
    if (transactionHash) {
      await this.db.setOrderDepositTx(order.id, transactionHash);
    }

    // Fire-and-forget COP conversion (mark failed on error instead of silently swallowing)
    this.initiateCopConversion(order).catch(async (err) => {
      this.logger.error(
        `COP conversion failed for order ${order.id}: ${err.message}`,
      );
      await this.db.updateOrderStatus(order.id, 'withdrawal_failed').catch(() => {});
    });

    return order.id;
  }

  private async initiateCopConversion(order: any) {
    await this.db.updateOrderStatus(order.id, 'withdrawal_initiated');

    // Mural payout API requires at most 2 decimal places
    const payoutAmount =
      Math.floor(order.unique_amount_usdc * 100) / 100;
    const payoutReq = await this.mural.createPayoutRequest(
      CONFIG.muralAccountId,
      payoutAmount,
    );
    this.logger.log(
      `Created payout request ${payoutReq.id} for order ${order.id}`,
    );

    const executed = await this.mural.executePayoutRequest(payoutReq.id);
    this.logger.log(
      `Executed payout request ${payoutReq.id}, status: ${executed.status}`,
    );

    await this.db.createWithdrawal({
      id: uuid(),
      orderId: order.id,
      amountUsdc: order.unique_amount_usdc,
      muralPayoutRequestId: payoutReq.id,
    });
  }
}

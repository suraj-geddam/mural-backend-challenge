import { Controller, Post, Req, Logger, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Request } from 'express';
import { createVerify } from 'crypto';
import { OrdersService } from './orders.service';
import { CONFIG } from './config';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private ordersService: OrdersService) {}

  @Post('mural')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mural webhook receiver for balance activity events',
  })
  async handleMuralWebhook(@Req() req: Request) {
    const signature = req.headers['x-mural-webhook-signature'] as string;
    const timestamp = req.headers['x-mural-webhook-timestamp'] as string;
    const rawBody = (req as any).rawBody?.toString('utf-8');

    // Verify ECDSA signature
    if (CONFIG.webhookPublicKey && signature && timestamp && rawBody) {
      const message = `${timestamp}.${rawBody}`;
      const verify = createVerify('SHA256');
      verify.update(message);
      const isValid = verify.verify(
        CONFIG.webhookPublicKey,
        Buffer.from(signature, 'base64'),
      );
      if (!isValid) {
        this.logger.warn('Invalid webhook signature');
        return { received: true, error: 'invalid signature' };
      }
    }

    const body = req.body;
    this.logger.log(`Webhook event: ${body.type || 'unknown'}`);

    if (body.type === 'account_credited') {
      const tokenAmount = body.token?.tokenAmount;
      const txHash = body.transactionDetails?.hash;
      if (tokenAmount) {
        const orderId = await this.ordersService.handleDeposit(
          tokenAmount,
          txHash,
        );
        return { received: true, matched: !!orderId, orderId };
      }
    }

    return { received: true };
  }
}

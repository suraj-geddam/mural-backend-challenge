import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DatabaseService } from './database.service';
import { MuralService } from './mural.service';

@ApiTags('Merchant')
@Controller('merchant')
export class MerchantController {
  constructor(
    private db: DatabaseService,
    private mural: MuralService,
  ) {}

  @Get('orders')
  @ApiOperation({ summary: 'List all orders with payment status' })
  listOrders() {
    return this.db.getAllOrders();
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Get order detail with payment confirmation' })
  async getOrder(@Param('id') id: string) {
    const order = await this.db.getOrder(id);
    if (!order) throw new NotFoundException('Order not found');
    const withdrawal = await this.db.getWithdrawalByOrderId(id);
    return { ...order, withdrawal };
  }

  @Get('withdrawals')
  @ApiOperation({ summary: 'List all COP withdrawals with current status' })
  async listWithdrawals() {
    const withdrawals = (await this.db.getAllWithdrawals()) as any[];

    // Poll Mural for latest status on executing withdrawals
    for (const w of withdrawals) {
      if (w.status === 'executing' && w.mural_payout_request_id) {
        try {
          const payout = await this.mural.getPayoutRequest(
            w.mural_payout_request_id,
          );
          if (payout.status === 'EXECUTED') {
            await this.db.updateWithdrawalStatus(w.id, 'completed');
            w.status = 'completed';
          } else if (payout.status === 'FAILED') {
            await this.db.updateWithdrawalStatus(w.id, 'failed');
            w.status = 'failed';
          }
          w.muralStatus = payout.status;
          w.muralPayouts = payout.payouts;
        } catch {
          // Non-critical: return stale status
        }
      }
    }

    return withdrawals;
  }
}

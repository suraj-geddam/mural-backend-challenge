import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { OrdersService } from './orders.service';

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new order (checkout)' })
  create(
    @Body()
    body: {
      customerEmail: string;
      items: { productId: string; quantity: number }[];
    },
  ) {
    return this.ordersService.createOrder(body.customerEmail, body.items);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order status and payment instructions' })
  async get(@Param('id') id: string) {
    const order = await this.ordersService.getOrder(id);
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }
}

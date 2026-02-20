import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseService } from './database.service';
import { MuralService } from './mural.service';
import { OrdersService } from './orders.service';
import { BootstrapService } from './bootstrap.service';
import { ProductsController } from './products.controller';
import { OrdersController } from './orders.controller';
import { MerchantController } from './merchant.controller';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [
    ProductsController,
    OrdersController,
    MerchantController,
    WebhooksController,
  ],
  providers: [DatabaseService, MuralService, OrdersService, BootstrapService],
})
export class AppModule {}

import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DatabaseService } from './database.service';

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private db: DatabaseService) {}

  @Get()
  @ApiOperation({ summary: 'List all products in the catalog' })
  list() {
    return this.db.getAllProducts();
  }
}

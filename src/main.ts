import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'fs';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  const config = new DocumentBuilder()
    .setTitle('Mural Marketplace API')
    .setDescription(
      'Backend service for marketplace with USDC payments and COP withdrawals',
    )
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);

  writeFileSync('./openapi.json', JSON.stringify(document, null, 2));

  await app.listen(process.env.PORT || 3000);
}
bootstrap();

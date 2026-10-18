import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { configureApp } from './app';
import { AppModule } from './app.module';
import { loadDotEnv } from './config/dotenv';
import { ENV, type Env } from './config/env';

async function bootstrap(): Promise<void> {
  loadDotEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const env = app.get<Env>(ENV);
  configureApp(app, env);
  await app.listen(env.API_PORT, '0.0.0.0');
}

void bootstrap();

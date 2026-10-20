import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ENV, type Env } from '../config/env';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OAuthController } from './oauth.controller';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';
import { TokensService } from './tokens.service';

export const JWT_ISSUER = 'wasafili';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        secret: env.JWT_SECRET,
        signOptions: { algorithm: 'HS256', issuer: JWT_ISSUER },
        verifyOptions: { algorithms: ['HS256'], issuer: JWT_ISSUER },
      }),
    }),
  ],
  controllers: [OAuthController, PasswordResetController],
  providers: [AuthService, TokensService, JwtAuthGuard, PasswordResetService],
  exports: [AuthService, TokensService, JwtAuthGuard],
})
export class AuthModule {}

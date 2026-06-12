import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { MatchesModule } from './matches/matches.module';
import { PredictionsModule } from './predictions/predictions.module';
import { ScoringModule } from './scoring/scoring.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule, 
    MatchesModule, 
    PredictionsModule, 
    ScoringModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

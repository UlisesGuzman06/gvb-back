import { Module } from '@nestjs/common';
import { PredictionsController } from './predictions.controller';
import { PredictionsService } from './predictions.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MatchesModule } from '../matches/matches.module';

@Module({
  imports: [PrismaModule, MatchesModule],
  controllers: [PredictionsController],
  providers: [PredictionsService]
})
export class PredictionsModule {}

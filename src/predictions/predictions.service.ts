import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MatchesService } from '../matches/matches.service';

@Injectable()
export class PredictionsService {
  constructor(
    private prisma: PrismaService,
    private matchesService: MatchesService,
  ) {}

  getLockLimit(matchDate: Date) {
    const dayBefore = new Date(matchDate.getTime() - 24 * 60 * 60 * 1000);
    dayBefore.setHours(23, 59, 59, 999);
    return dayBefore;
  }

  async getUserPredictions(userId: string) {
    const list = await this.prisma.prediction.findMany({
      where: { userId },
    });
    
    const map: Record<string, { homeScore: number; awayScore: number; points: number }> = {};
    for (const p of list) {
      map[p.matchId] = {
        homeScore: p.homeScore,
        awayScore: p.awayScore,
        points: p.points,
      };
    }
    return map;
  }

  async savePredictions(userId: string, predictions: Record<string, { homeScore: number | ''; awayScore: number | '' }>) {
    for (const matchId of Object.keys(predictions)) {
      const { homeScore, awayScore } = predictions[matchId];
      if (homeScore === '' || awayScore === '') {
        continue;
      }

      const match = await this.prisma.match.findUnique({ where: { id: matchId } });
      if (!match) continue;

      const limit = this.getLockLimit(match.date);
      if (new Date() > limit) {
        continue;
      }

      await this.prisma.prediction.upsert({
        where: {
          userId_matchId: { userId, matchId },
        },
        update: {
          homeScore: Number(homeScore),
          awayScore: Number(awayScore),
        },
        create: {
          userId,
          matchId,
          homeScore: Number(homeScore),
          awayScore: Number(awayScore),
        },
      });
    }

    return { success: true };
  }

  async savePredictionsAdmin(userId: string, predictions: Record<string, { homeScore: number | ''; awayScore: number | '' }>) {
    for (const matchId of Object.keys(predictions)) {
      const { homeScore, awayScore } = predictions[matchId];
      if (homeScore === '' || awayScore === '') {
        try {
          await this.prisma.prediction.delete({
            where: {
              userId_matchId: { userId, matchId },
            },
          });
        } catch (e) {}
        continue;
      }

      await this.prisma.prediction.upsert({
        where: {
          userId_matchId: { userId, matchId },
        },
        update: {
          homeScore: Number(homeScore),
          awayScore: Number(awayScore),
        },
        create: {
          userId,
          matchId,
          homeScore: Number(homeScore),
          awayScore: Number(awayScore),
        },
      });
    }

    await this.matchesService.recalculateAllUsersPoints();
    return { success: true };
  }

  async getBonusPrediction(userId: string) {
    const bonus = await this.prisma.bonusPrediction.findUnique({
      where: { userId },
    });
    return bonus || { champion: '', subchampion: '', topScorer: '', goldenBall: '', goldenGlove: '' };
  }

  async saveBonusPrediction(userId: string, data: { champion: string; subchampion: string; topScorer: string; goldenBall?: string; goldenGlove?: string }) {
    // Check if bonus predictions already exist — they are locked once set
    const existing = await this.prisma.bonusPrediction.findUnique({ where: { userId } });
    if (existing) {
      throw new BadRequestException('Los pronósticos especiales ya están guardados y no se pueden modificar.');
    }

    await this.prisma.bonusPrediction.create({
      data: {
        userId,
        champion: data.champion,
        subchampion: data.subchampion,
        topScorer: data.topScorer,
        goldenBall: data.goldenBall,
        goldenGlove: data.goldenGlove,
      },
    });

    return { success: true };
  }


  async saveBonusPredictionAdmin(userId: string, data: { champion: string; subchampion: string; topScorer: string; goldenBall?: string; goldenGlove?: string }) {
    // Bonus predictions are permanently locked — nobody can change them once set
    throw new BadRequestException('Los pronósticos especiales son definitivos y no se pueden modificar.');
  }
}

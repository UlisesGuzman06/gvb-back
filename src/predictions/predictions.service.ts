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
    // Close predictions exactly at the match start time
    return matchDate;
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

  async getCompanionPredictions(userId: string, isSelf = false) {
    const list = await this.prisma.prediction.findMany({
      where: { userId },
      include: { match: true },
    });
    
    const map: Record<string, { homeScore: number | null; awayScore: number | null; points: number; isLocked: boolean }> = {};
    const now = new Date();
    for (const p of list) {
      const limit = this.getLockLimit(p.match.date);
      const isLocked = now.getTime() > limit.getTime() || p.match.status === 'FINISHED';
      
      map[p.matchId] = {
        homeScore: p.homeScore,
        awayScore: p.awayScore,
        points: p.points,
        isLocked,
      };
    }
    return map;
  }

  async getPredictionsForMatch(matchId: string, currentUserId: string) {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
    });
    if (!match) {
      throw new BadRequestException('Partido no encontrado');
    }

    const limit = this.getLockLimit(match.date);
    const now = new Date();
    const isLocked = now.getTime() > limit.getTime() || match.status === 'FINISHED';

    const users = await this.prisma.user.findMany({
      where: {
        role: {
          not: 'ADMIN',
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    const predictions = await this.prisma.prediction.findMany({
      where: { matchId },
    });

    const predictionsMap = new Map(predictions.map(p => [p.userId, p]));

    const results = users.map(user => {
      const p = predictionsMap.get(user.id);
      const isSelf = user.id === currentUserId;

      return {
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        homeScore: p ? p.homeScore : null,
        awayScore: p ? p.awayScore : null,
        hasPrediction: !!p,
        isLocked,
        isSelf,
      };
    });

    return results.sort((a, b) => {
      if (a.isSelf) return -1;
      if (b.isSelf) return 1;
      return a.userName.localeCompare(b.userName);
    });
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

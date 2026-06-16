import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class MatchesService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedMatchesAndMockUsers();
  }

  async seedMatchesAndMockUsers() {
    const matchCount = await this.prisma.match.count();
    if (matchCount > 0) {
      return;
    }

    console.log('[Seeding] Match table is empty. Starting seeding...');

    try {
      const filePath = path.join(process.cwd(), './partidos.json');
      if (!fs.existsSync(filePath)) {
        console.error(`[Seeding Error] partidos.json not found at ${filePath}`);
        return;
      }

      const fileContent = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(fileContent);
      const rawMatches = data.matches || [];

      for (let idx = 0; idx < rawMatches.length; idx++) {
        const match = rawMatches[idx];
        const matchNum = match.num || (idx + 1);
        const matchId = String(matchNum);

        let timeStr = '12:00:00';
        let tzOffset = 'Z';
        if (match.time) {
          const parts = match.time.split(' ');
          if (parts[0]) {
            timeStr = parts[0];
            if (timeStr.length === 5) {
              timeStr = `${timeStr}:00`;
            }
          }
          if (parts[1]) {
            const tz = parts[1];
            const matchOffset = tz.match(/UTC([+-]\d+)/);
            if (matchOffset) {
              const num = parseInt(matchOffset[1], 10);
              const sign = num >= 0 ? '+' : '-';
              const absNum = Math.abs(num);
              tzOffset = `${sign}${String(absNum).padStart(2, '0')}:00`;
            }
          }
        }

        const dateObj = new Date(`${match.date}T${timeStr}${tzOffset}`);

        await this.prisma.match.create({
          data: {
            id: matchId,
            homeTeam: match.team1 || 'Por definir',
            awayTeam: match.team2 || 'Por definir',
            group: match.group || match.round || '',
            round: match.round || 'Grupo',
            time: timeStr,
            location: match.ground || 'Estadio por definir',
            num: matchNum,
            date: dateObj,
            status: 'SCHEDULED',
          },
        });
      }

      console.log(`[Seeding] Successfully seeded ${rawMatches.length} matches.`);
    } catch (error) {
      console.error('[Seeding Error] Failed to seed matches:', error);
    }
  }

  async findAll() {
    const list = await this.prisma.match.findMany({
      orderBy: [
        { date: 'asc' },
        { time: 'asc' },
      ],
    });

    return list.map(m => ({
      id: m.id,
      date: m.date.toISOString().split('T')[0],
      time: m.time || '12:00:00',
      location: m.location || 'Estadio Azteca',
      round: m.round || 'Grupo',
      group: m.group,
      group_id: 0,
      home: {
        id: 0,
        name: m.homeTeam,
        logo: '',
      },
      away: {
        id: 0,
        name: m.awayTeam,
        logo: '',
      },
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      status: m.status,
    }));
  }

  async updateResult(id: string, homeScore: number, awayScore: number) {
    const match = await this.prisma.match.update({
      where: { id },
      data: {
        homeScore,
        awayScore,
        status: 'FINISHED',
      },
    });

    const predictions = await this.prisma.prediction.findMany({
      where: { matchId: id },
    });

    const isDouble = match.homeTeam === 'Argentina' || match.awayTeam === 'Argentina';
    const multiplier = isDouble ? 2 : 1;

    for (const pred of predictions) {
      let points = 0;
      if (pred.homeScore === homeScore && pred.awayScore === awayScore) {
        points = 3 * multiplier;
      } else if (
        (pred.homeScore > pred.awayScore && homeScore > awayScore) ||
        (pred.homeScore < pred.awayScore && homeScore < awayScore) ||
        (pred.homeScore === pred.awayScore && homeScore === awayScore)
      ) {
        points = 1 * multiplier;
      }

      await this.prisma.prediction.update({
        where: { id: pred.id },
        data: { points },
      });
    }

    await this.recalculateAllUsersPoints();
    return match;
  }

  async recalculateAllUsersPoints() {
    const users = await this.prisma.user.findMany();
    for (const user of users) {
      const predictions = await this.prisma.prediction.findMany({
        where: { userId: user.id },
        include: { match: true },
      });

      const finishedPredictions = predictions.filter(p => p.match.status === 'FINISHED');

      let totalPoints = 0;
      let exactMatches = 0;
      let trends = 0;

      for (const p of finishedPredictions) {
        if (p.match.homeScore === null || p.match.awayScore === null) continue;

        const isDouble = p.match.homeTeam === 'Argentina' || p.match.awayTeam === 'Argentina';
        const multiplier = isDouble ? 2 : 1;

        if (p.homeScore === p.match.homeScore && p.awayScore === p.match.awayScore) {
          exactMatches++;
          totalPoints += 3 * multiplier;
        } else if (
          (p.homeScore > p.awayScore && p.match.homeScore > p.match.awayScore) ||
          (p.homeScore < p.awayScore && p.match.homeScore < p.match.awayScore) ||
          (p.homeScore === p.awayScore && p.match.homeScore === p.match.awayScore)
        ) {
          trends++;
          totalPoints += 1 * multiplier;
        }
      }

      const bonus = await this.prisma.bonusPrediction.findUnique({
        where: { userId: user.id },
      });

      let bonusPoints = 0;
      if (bonus) {
        const config = await this.prisma.tournamentConfig.findUnique({
          where: { id: 'global' },
        });

        if (config) {
          if (config.champion && bonus.champion === config.champion) {
            bonusPoints += 10;
          }
          if (config.subchampion && bonus.subchampion === config.subchampion) {
            bonusPoints += 5;
          }
          if (config.topScorer && bonus.topScorer && bonus.topScorer.trim().toLowerCase() === config.topScorer.trim().toLowerCase()) {
            bonusPoints += 5;
          }
          if (config.goldenBall && bonus.goldenBall && bonus.goldenBall.trim().toLowerCase() === config.goldenBall.trim().toLowerCase()) {
            bonusPoints += 5;
          }
          if (config.goldenGlove && bonus.goldenGlove && bonus.goldenGlove.trim().toLowerCase() === config.goldenGlove.trim().toLowerCase()) {
            bonusPoints += 5;
          }
        }
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          points: totalPoints + bonusPoints,
          exactMatches,
          trends,
          bonusPoints,
        },
      });
    }
  }

  async getTournamentConfig() {
    const config = await this.prisma.tournamentConfig.findUnique({
      where: { id: 'global' },
    });
    return config || { champion: '', subchampion: '', topScorer: '', goldenBall: '', goldenGlove: '' };
  }

  async updateTournamentResults(data: { champion: string; subchampion: string; topScorer: string; goldenBall?: string; goldenGlove?: string }) {
    const config = await this.prisma.tournamentConfig.upsert({
      where: { id: 'global' },
      update: {
        champion: data.champion,
        subchampion: data.subchampion,
        topScorer: data.topScorer,
        goldenBall: data.goldenBall,
        goldenGlove: data.goldenGlove,
      },
      create: {
        id: 'global',
        champion: data.champion,
        subchampion: data.subchampion,
        topScorer: data.topScorer,
        goldenBall: data.goldenBall,
        goldenGlove: data.goldenGlove,
      },
    });

    await this.recalculateAllUsersPoints();
    return config;
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const list = await this.prisma.user.findMany({
      where: {
        role: {
          not: 'ADMIN',
        },
      },
      include: {
        bonusPrediction: true,
      },
    });

    return list.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      points: u.points,
      exactMatches: u.exactMatches,
      trends: u.trends,
      bonus: {
        champion: u.bonusPrediction?.champion || 'Por elegir',
        subchampion: u.bonusPrediction?.subchampion || 'Por elegir',
        topScorer: u.bonusPrediction?.topScorer || 'Por elegir',
        goldenBall: u.bonusPrediction?.goldenBall || 'Por elegir',
        goldenGlove: u.bonusPrediction?.goldenGlove || 'Por elegir',
      },
    }));
  }
}

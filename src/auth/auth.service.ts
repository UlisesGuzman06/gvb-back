import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async checkEmail(email: string) {
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new BadRequestException('Ese correo ya está registrado. Usá otro o iniciá sesión.');
    }
    return { available: true };
  }

  async register(data: any) {

    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new BadRequestException('El correo electrónico ya está registrado.');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const user = await this.prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        password: hashedPassword,
        role: data.role || 'USER',
      },
    });

    // Save bonus predictions if provided at registration
    if (data.champion || data.subchampion || data.topScorer || data.goldenBall || data.goldenGlove) {
      await this.prisma.bonusPrediction.create({
        data: {
          userId: user.id,
          champion: data.champion || null,
          subchampion: data.subchampion || null,
          topScorer: data.topScorer || null,
          goldenBall: data.goldenBall || null,
          goldenGlove: data.goldenGlove || null,
          points: 0,
        },
      });
    }

    // Exclude password from the returned object
    const { password, ...result } = user;
    return result;
  }


  async login(data: any) {
    const user = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (!user) {
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    const isPasswordValid = await bcrypt.compare(data.password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    const payload = { email: user.email, sub: user.id, role: user.role };
    
    // Exclude password
    const { password, ...result } = user;

    return {
      access_token: this.jwtService.sign(payload),
      user: result,
    };
  }
}

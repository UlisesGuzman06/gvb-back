import { Controller, Get, Post, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { MatchesService } from './matches.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('matches')
@UseGuards(JwtAuthGuard)
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Get()
  async getMatches() {
    return this.matchesService.findAll();
  }

  @Get('tournament/config')
  async getTournamentConfig() {
    return this.matchesService.getTournamentConfig();
  }

  @Post('tournament/results')
  @UseGuards(AdminGuard)
  async updateTournamentResults(
    @Body() body: { champion: string; subchampion: string; topScorer: string; goldenBall?: string; goldenGlove?: string },
  ) {
    return this.matchesService.updateTournamentResults(body);
  }

  @Patch(':id/result')
  @UseGuards(AdminGuard)
  async updateResult(
    @Param('id') id: string,
    @Body() body: { homeScore: number; awayScore: number },
  ) {
    return this.matchesService.updateResult(id, body.homeScore, body.awayScore);
  }
}

import { Controller, Get, Post, Param, Body, Request, UseGuards } from '@nestjs/common';
import { PredictionsService } from './predictions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('predictions')
@UseGuards(JwtAuthGuard)
export class PredictionsController {
  constructor(private readonly predictionsService: PredictionsService) {}

  @Get('my')
  async getMyPredictions(@Request() req: any) {
    return this.predictionsService.getUserPredictions(req.user.userId);
  }

  @Post('save')
  async saveMyPredictions(
    @Request() req: any,
    @Body() predictions: Record<string, { homeScore: number | ''; awayScore: number | '' }>,
  ) {
    return this.predictionsService.savePredictions(req.user.userId, predictions);
  }

  @Get('bonus/my')
  async getMyBonus(@Request() req: any) {
    return this.predictionsService.getBonusPrediction(req.user.userId);
  }

  @Post('bonus/save')
  async saveMyBonus(
    @Request() req: any,
    @Body() body: { champion: string; subchampion: string; topScorer: string; goldenBall?: string; goldenGlove?: string },
  ) {
    return this.predictionsService.saveBonusPrediction(req.user.userId, body);
  }

  @Get('companion/:userId')
  async getCompanionPredictions(@Param('userId') userId: string) {
    return this.predictionsService.getCompanionPredictions(userId);
  }

  // Admin Overrides
  @Get('user/:userId')
  @UseGuards(AdminGuard)
  async getUserPredictionsAdmin(@Param('userId') userId: string) {
    return this.predictionsService.getUserPredictions(userId);
  }

  @Post('admin/:userId')
  @UseGuards(AdminGuard)
  async saveUserPredictionsAdmin(
    @Param('userId') userId: string,
    @Body() predictions: Record<string, { homeScore: number | ''; awayScore: number | '' }>,
  ) {
    return this.predictionsService.savePredictionsAdmin(userId, predictions);
  }

  @Get('bonus/user/:userId')
  @UseGuards(AdminGuard)
  async getUserBonusAdmin(@Param('userId') userId: string) {
    return this.predictionsService.getBonusPrediction(userId);
  }

  @Post('bonus/admin/:userId')
  @UseGuards(AdminGuard)
  async saveUserBonusAdmin(
    @Param('userId') userId: string,
    @Body() body: { champion: string; subchampion: string; topScorer: string; goldenBall?: string; goldenGlove?: string },
  ) {
    return this.predictionsService.saveBonusPredictionAdmin(userId, body);
  }
}

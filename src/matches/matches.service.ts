import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

const TEAM_TRANSLATIONS: Record<string, string> = {
  // Group A
  'Mexico': 'México', 'South Africa': 'Sudáfrica', 'South Korea': 'Corea del Sur', 'Czech Republic': 'República Checa',
  // Group B
  'Canada': 'Canadá', 'Bosnia & Herzegovina': 'Bosnia y Herzegovina', 'Bosnia and Herzegovina': 'Bosnia y Herzegovina', 'Qatar': 'Catar', 'Switzerland': 'Suiza',
  // Group C
  'Brazil': 'Brasil', 'Morocco': 'Marruecos', 'Haiti': 'Haití', 'Scotland': 'Escocia',
  // Group D
  'USA': 'Estados Unidos', 'United States': 'Estados Unidos', 'Australia': 'Australia', 'Turkey': 'Turquía', 'Paraguay': 'Paraguay',
  // Group E
  'Germany': 'Alemania', 'Curacao': 'Curazao', 'Ivory Coast': 'Costa de Marfil', 'Ecuador': 'Ecuador',
  // Group F
  'Netherlands': 'Países Bajos', 'Japan': 'Japón', 'Sweden': 'Suecia', 'Tunisia': 'Túnez',
  // Group G
  'Belgium': 'Bélgica', 'Egypt': 'Egipto', 'Iran': 'Irán', 'New Zealand': 'Nueva Zelanda',
  // Group H
  'Spain': 'España', 'Cape Verde': 'Cabo Verde', 'Saudi Arabia': 'Arabia Saudita', 'Uruguay': 'Uruguay',
  // Group I
  'France': 'Francia', 'Senegal': 'Senegal', 'Iraq': 'Irak', 'Norway': 'Noruega',
  // Group J
  'Argentina': 'Argentina', 'Algeria': 'Argelia', 'Austria': 'Austria', 'Jordan': 'Jordania',
  // Group K
  'Portugal': 'Portugal', 'DR Congo': 'RD Congo', 'Congo DR': 'RD Congo', 'Uzbekistan': 'Uzbekistán', 'Colombia': 'Colombia',
  // Group L
  'England': 'Inglaterra', 'Croatia': 'Croacia', 'Ghana': 'Ghana', 'Panama': 'Panamá'
};

const ROUND_MAPPING: Record<string, string> = {
  'Round of 32': '16avos de Final',
  'Round of 16': 'Octavos de Final',
  'Quarter-finals': 'Cuartos de Final',
  'Semi-finals': 'Semifinal',
  '3rd Place Match': 'Tercer Puesto',
  'Third Place Play-off': 'Tercer Puesto',
  'Final': 'Final'
};

function normalizeTeamName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

@Injectable()
export class MatchesService implements OnModuleInit {
  private teamLogos: Record<string, string> = {};
  private logosFilePath = path.join(process.cwd(), './team_logos.json');

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    this.loadLogos();
    await this.manualSeed(false);
    
    // Recalculate all users points asynchronously on startup to fix historical data without blocking NestJS
    setTimeout(async () => {
      try {
        console.log('[MatchesService] Starting asynchronous points recalculation...');
        await this.recalculateAllUsersPoints();
        await this.recalculateKnockoutPropagation();
        console.log('[MatchesService] Asynchronous points recalculation completed.');
      } catch (err) {
        console.error('[MatchesService] Asynchronous points recalculation failed:', err);
      }
    }, 1000);

    // NOTE: Auto-sync con API-Football deshabilitado (plan Free no da acceso a season 2026).
    // Para sincronizar manualmente, usar GET /matches/sync desde el panel de admin.
  }

  async manualSeed(force = false) {
    const logs: string[] = [];
    logs.push(`[Seeding] Started seeding process...`);

    const apiKey = process.env.API_FOOTBALL_KEY || '193840fb024aae2b71d8b46d1c7d174d';
    const season = process.env.API_FOOTBALL_SEASON || '2026';
    const league = process.env.API_FOOTBALL_LEAGUE || '1';

    try {
      const matchCount = await this.prisma.match.count();
      logs.push(`Current database match count: ${matchCount}`);

      if (matchCount > 0 && !force) {
        logs.push(`Matches already exist. Skipping seed.`);
        console.log(`[Seeding] Matches already exist, skipping.`);
        return { success: true, logs };
      }

      console.log(`[Seeding] Attempting to seed matches from API-Football...`);
      let fixtures: any[] = [];
      let teamGroups: Record<string, string> = {};
      let apiSuccess = false;

      try {
        const response = await fetch(
          `https://v3.football.api-sports.io/fixtures?league=${league}&season=${season}`,
          { headers: { 'x-apisports-key': apiKey } }
        );

        if (response.ok) {
          const data: any = await response.json();
          if (!data.errors || Object.keys(data.errors).length === 0 || data.response?.length) {
            fixtures = data.response || [];
            if (fixtures.length > 0) {
              apiSuccess = true;
              logs.push(`Fetched ${fixtures.length} fixtures from API.`);

              // Try to fetch standings for group mapping
              try {
                const standingsRes = await fetch(
                  `https://v3.football.api-sports.io/standings?league=${league}&season=${season}`,
                  { headers: { 'x-apisports-key': apiKey } }
                );
                if (standingsRes.ok) {
                  const standingsData: any = await standingsRes.json();
                  const groupsList = standingsData.response?.[0]?.league?.standings || [];
                  for (const groupTable of groupsList) {
                    for (const row of groupTable) {
                      const teamName = row.team.name;
                      const groupName = row.group;
                      const translatedGroup = groupName ? groupName.replace('Group', 'Grupo') : '';
                      teamGroups[teamName] = translatedGroup;
                    }
                  }
                }
              } catch (stError) {
                console.warn(`[Seeding] Could not load standings for group mapping:`, stError);
              }
            }
          } else {
            logs.push(`API returned error: ${JSON.stringify(data.errors)}`);
          }
        } else {
          logs.push(`HTTP error ${response.status}`);
        }
      } catch (apiError: any) {
        logs.push(`API Fetch failed: ${apiError.message || apiError}`);
      }

      if (!apiSuccess) {
        logs.push(`[Seeding Fallback] API seed not available. Seeding from local partidos.json...`);
        console.log(`[Seeding Fallback] API seed failed/blocked. Seeding from local partidos.json...`);
        
        // Fallback to partidos.json
        const filePath = path.join(process.cwd(), './partidos.json');
        const exists = fs.existsSync(filePath);
        const fallbackPath = path.join(__dirname, '../../partidos.json');
        const fallbackExists = fs.existsSync(fallbackPath);
        const fallbackPath2 = path.join(__dirname, '../../../partidos.json');
        const fallback2Exists = fs.existsSync(fallbackPath2);

        if (!exists && !fallbackExists && !fallback2Exists) {
          throw new Error(`[Seeding Error] partidos.json not found in any path.`);
        }

        const finalPath = exists ? filePath : (fallbackExists ? fallbackPath : fallbackPath2);
        const fileContent = fs.readFileSync(finalPath, 'utf8');
        const data = JSON.parse(fileContent);
        const rawMatches = data.matches || [];

        if (force) {
          await this.prisma.match.deleteMany({});
        }

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
              status: match.status || 'SCHEDULED',
              homeScore: match.homeScore !== undefined ? match.homeScore : null,
              awayScore: match.awayScore !== undefined ? match.awayScore : null,
            },
          });
        }

        return { success: true, logs };
      }

      // Seed from API
      if (force) {
        await this.prisma.match.deleteMany({});
      }

      // Sort by date to assign match numbers sequentially
      fixtures.sort((a: any, b: any) => a.fixture.timestamp - b.fixture.timestamp);

      let logosUpdated = false;

      for (let idx = 0; idx < fixtures.length; idx++) {
        const apiFixture = fixtures[idx];
        const matchNum = idx + 1;
        const matchId = String(apiFixture.fixture.id);

        const apiHome = apiFixture.teams.home.name;
        const apiAway = apiFixture.teams.away.name;
        const translatedHome = TEAM_TRANSLATIONS[apiHome] || apiHome;
        const translatedAway = TEAM_TRANSLATIONS[apiAway] || apiAway;

        if (apiFixture.teams.home.logo && this.teamLogos[translatedHome] !== apiFixture.teams.home.logo) {
          this.teamLogos[translatedHome] = apiFixture.teams.home.logo;
          logosUpdated = true;
        }
        if (apiFixture.teams.away.logo && this.teamLogos[translatedAway] !== apiFixture.teams.away.logo) {
          this.teamLogos[translatedAway] = apiFixture.teams.away.logo;
          logosUpdated = true;
        }

        const apiRound = apiFixture.league.round;
        let mappedRound = apiRound;

        if (apiRound.toLowerCase().includes('group stage')) {
          const m = apiRound.match(/\d+/);
          mappedRound = m ? `Fecha ${m[0]}` : 'Grupo';
        } else {
          for (const key of Object.keys(ROUND_MAPPING)) {
            if (apiRound.toLowerCase().includes(key.toLowerCase())) {
              mappedRound = ROUND_MAPPING[key];
              break;
            }
          }
        }

        const groupName = teamGroups[apiHome] || teamGroups[apiAway] || (mappedRound.includes('Fecha') ? 'Grupo' : mappedRound);

        const dateObj = new Date(apiFixture.fixture.date);
        const timeStr = dateObj.toISOString().split('T')[1].substring(0, 8);

        const apiStatus = apiFixture.fixture.status.short;
        let dbStatus: 'SCHEDULED' | 'IN_PROGRESS' | 'FINISHED' = 'SCHEDULED';
        if (['FT', 'AET', 'PEN'].includes(apiStatus)) {
          dbStatus = 'FINISHED';
        } else if (['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].includes(apiStatus)) {
          dbStatus = 'IN_PROGRESS';
        }

        await this.prisma.match.create({
          data: {
            id: matchId,
            homeTeam: translatedHome,
            awayTeam: translatedAway,
            group: groupName,
            round: mappedRound,
            time: timeStr,
            location: `${apiFixture.fixture.venue.name || 'Estadio'}, ${apiFixture.fixture.venue.city || 'Sede'}`,
            num: matchNum,
            date: dateObj,
            status: dbStatus,
            homeScore: apiFixture.goals.home !== null ? Number(apiFixture.goals.home) : null,
            awayScore: apiFixture.goals.away !== null ? Number(apiFixture.goals.away) : null,
          },
        });
      }

      if (logosUpdated) {
        this.saveLogos();
      }

      logs.push(`Successfully seeded ${fixtures.length} matches directly from API.`);
      console.log(`[Seeding] Successfully seeded ${fixtures.length} matches directly from API.`);
      return { success: true, logs };

    } catch (error: any) {
      const errMsg = `[Seeding Error] Failed to seed matches: ${error.message || error}`;
      console.error(errMsg);
      logs.push(errMsg);
      return { success: false, logs };
    }
  }

  async findAll() {
    const list = await this.prisma.match.findMany({
      orderBy: [
        { date: 'asc' },
        { time: 'asc' },
      ],
    });

    const getTeamIdFromLogo = (logoUrl: string): number => {
      if (!logoUrl) return 0;
      const match = logoUrl.match(/teams\/(\d+)\.png/);
      return match ? parseInt(match[1], 10) : 0;
    };

    return list.map(m => {
      const homeLogoUrl = this.teamLogos[m.homeTeam] || '';
      const awayLogoUrl = this.teamLogos[m.awayTeam] || '';

      return {
        id: m.id,
        num: m.num,
        date: m.date.toISOString().split('T')[0],
        time: m.date.toISOString().split('T')[1].substring(0, 8),
        location: m.location || 'Estadio Azteca',
        round: m.round || 'Grupo',
        group: m.group,
        group_id: 0,
        home: {
          id: getTeamIdFromLogo(homeLogoUrl),
          name: m.homeTeam,
          logo: homeLogoUrl,
        },
        away: {
          id: getTeamIdFromLogo(awayLogoUrl),
          name: m.awayTeam,
          logo: awayLogoUrl,
        },
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        status: m.status,
        penaltyWinner: m.penaltyWinner,
      };
    });
  }

  async updateResult(id: string, homeScore: number, awayScore: number, penaltyWinner?: string) {
    const match = await this.prisma.match.update({
      where: { id },
      data: {
        homeScore,
        awayScore,
        penaltyWinner: penaltyWinner !== undefined ? penaltyWinner : null,
        status: 'FINISHED',
      },
    });

    const predictions = await this.prisma.prediction.findMany({
      where: { matchId: id },
    });

    const isArgentina = match.homeTeam === 'Argentina' || match.awayTeam === 'Argentina';

    for (const pred of predictions) {
      let points = 0;
      if (pred.homeScore === homeScore && pred.awayScore === awayScore) {
        points = isArgentina ? 4 : 3;
      } else if (
        (pred.homeScore > pred.awayScore && homeScore > awayScore) ||
        (pred.homeScore < pred.awayScore && homeScore < awayScore) ||
        (pred.homeScore === pred.awayScore && homeScore === awayScore)
      ) {
        points = 1;
      }

      await this.prisma.prediction.update({
        where: { id: pred.id },
        data: { points },
      });
    }

    await this.recalculateAllUsersPoints();
    await this.recalculateKnockoutPropagation();
    return match;
  }

  async recalculateAllUsersPoints() {
    console.log('[MatchesService] Recalculating all users points...');
    try {
      // 1. Fetch all users
      const users = await this.prisma.user.findMany();

      // 2. Fetch tournament config once
      const config = await this.prisma.tournamentConfig.findUnique({
        where: { id: 'global' },
      });

      // 3. Fetch all bonus predictions once
      const bonusList = await this.prisma.bonusPrediction.findMany();
      const bonusMap = new Map(bonusList.map(b => [b.userId, b]));

      // 4. Fetch all predictions once, including their matches
      const allPredictions = await this.prisma.prediction.findMany({
        include: { match: true },
      });

      // Group predictions by userId
      const predictionsByUser = new Map<string, typeof allPredictions>();
      for (const p of allPredictions) {
        if (!predictionsByUser.has(p.userId)) {
          predictionsByUser.set(p.userId, []);
        }
        predictionsByUser.get(p.userId)!.push(p);
      }

      const predictionUpdates: any[] = [];
      const userUpdates: any[] = [];

      for (const user of users) {
        const predictions = predictionsByUser.get(user.id) || [];

        let totalPoints = 0;
        let exactMatches = 0;
        let trends = 0;

        for (const p of predictions) {
          let calculatedPoints = 0;

          if (p.match.status === 'FINISHED' && p.match.homeScore !== null && p.match.awayScore !== null) {
            const isArgentina = p.match.homeTeam === 'Argentina' || p.match.awayTeam === 'Argentina';

            if (p.homeScore === p.match.homeScore && p.awayScore === p.match.awayScore) {
              exactMatches++;
              calculatedPoints = isArgentina ? 4 : 3;
              totalPoints += calculatedPoints;
            } else if (
              (p.homeScore > p.awayScore && p.match.homeScore > p.match.awayScore) ||
              (p.homeScore < p.awayScore && p.match.homeScore < p.match.awayScore) ||
              (p.homeScore === p.awayScore && p.match.homeScore === p.match.awayScore)
            ) {
              trends++;
              calculatedPoints = 1;
              totalPoints += calculatedPoints;
            }
          }

          if (p.points !== calculatedPoints) {
            predictionUpdates.push(
              this.prisma.prediction.update({
                where: { id: p.id },
                data: { points: calculatedPoints },
              })
            );
          }
        }

        const bonus = bonusMap.get(user.id);
        let bonusPoints = 0;
        if (bonus && config) {
          if (config.champion && bonus.champion === config.champion) {
            bonusPoints += 15;
          }
          if (config.subchampion && bonus.subchampion === config.subchampion) {
            bonusPoints += 10;
          }
          if (config.topScorer && bonus.topScorer && bonus.topScorer.trim().toLowerCase() === config.topScorer.trim().toLowerCase()) {
            bonusPoints += 10;
          }
          if (config.goldenBall && bonus.goldenBall && bonus.goldenBall.trim().toLowerCase() === config.goldenBall.trim().toLowerCase()) {
            bonusPoints += 10;
          }
          if (config.goldenGlove && bonus.goldenGlove && bonus.goldenGlove.trim().toLowerCase() === config.goldenGlove.trim().toLowerCase()) {
            bonusPoints += 10;
          }
        }

        const newPoints = totalPoints + bonusPoints;
        if (
          user.points !== newPoints ||
          user.exactMatches !== exactMatches ||
          user.trends !== trends ||
          user.bonusPoints !== bonusPoints
        ) {
          userUpdates.push(
            this.prisma.user.update({
              where: { id: user.id },
              data: {
                points: newPoints,
                exactMatches,
                trends,
                bonusPoints,
              },
            })
          );
        }
      }

      // Execute all updates in chunks/transactions to avoid locking or timeouts
      if (predictionUpdates.length > 0) {
        console.log(`[MatchesService] Batch updating ${predictionUpdates.length} predictions...`);
        for (let i = 0; i < predictionUpdates.length; i += 50) {
          const chunk = predictionUpdates.slice(i, i + 50);
          await this.prisma.$transaction(chunk);
        }
      }

      if (userUpdates.length > 0) {
        console.log(`[MatchesService] Batch updating ${userUpdates.length} users...`);
        for (let i = 0; i < userUpdates.length; i += 50) {
          const chunk = userUpdates.slice(i, i + 50);
          await this.prisma.$transaction(chunk);
        }
      }

      console.log('[MatchesService] Recalculate all users points completed.');
    } catch (err) {
      console.error('[MatchesService Error] Failed to recalculate user points:', err);
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

  // Load and save team logos functions
  private loadLogos() {
    try {
      if (fs.existsSync(this.logosFilePath)) {
        const content = fs.readFileSync(this.logosFilePath, 'utf8');
        this.teamLogos = JSON.parse(content);
        console.log(`[MatchesService] Loaded ${Object.keys(this.teamLogos).length} team logos from team_logos.json`);
      } else {
        // Pre-populate with standard logos from API-Football for all 48 national teams of World Cup 2026
        this.teamLogos = {
          'Bélgica': 'https://media.api-sports.io/football/teams/1.png',
          'Francia': 'https://media.api-sports.io/football/teams/2.png',
          'Croacia': 'https://media.api-sports.io/football/teams/3.png',
          'Suecia': 'https://media.api-sports.io/football/teams/5.png',
          'Brasil': 'https://media.api-sports.io/football/teams/6.png',
          'Uruguay': 'https://media.api-sports.io/football/teams/7.png',
          'Colombia': 'https://media.api-sports.io/football/teams/8.png',
          'España': 'https://media.api-sports.io/football/teams/9.png',
          'Inglaterra': 'https://media.api-sports.io/football/teams/10.png',
          'Panamá': 'https://media.api-sports.io/football/teams/11.png',
          'Japón': 'https://media.api-sports.io/football/teams/12.png',
          'Senegal': 'https://media.api-sports.io/football/teams/13.png',
          'Serbia': 'https://media.api-sports.io/football/teams/14.png',
          'Suiza': 'https://media.api-sports.io/football/teams/15.png',
          'México': 'https://media.api-sports.io/football/teams/16.png',
          'Corea del Sur': 'https://media.api-sports.io/football/teams/17.png',
          'Camerún': 'https://media.api-sports.io/football/teams/18.png',
          'Australia': 'https://media.api-sports.io/football/teams/20.png',
          'Arabia Saudita': 'https://media.api-sports.io/football/teams/23.png',
          'Polonia': 'https://media.api-sports.io/football/teams/24.png',
          'Alemania': 'https://media.api-sports.io/football/teams/25.png',
          'Argentina': 'https://media.api-sports.io/football/teams/26.png',
          'Portugal': 'https://media.api-sports.io/football/teams/27.png',
          'Túnez': 'https://media.api-sports.io/football/teams/28.png',
          'Costa Rica': 'https://media.api-sports.io/football/teams/29.png',
          'Egipto': 'https://media.api-sports.io/football/teams/32.png',
          'Marruecos': 'https://media.api-sports.io/football/teams/31.png',
          'Costa de Marfil': 'https://media.api-sports.io/football/teams/1501.png',
          'Ghana': 'https://media.api-sports.io/football/teams/1504.png',
          'RD Congo': 'https://media.api-sports.io/football/teams/1508.png',
          'Catar': 'https://media.api-sports.io/football/teams/1569.png',
          'Ecuador': 'https://media.api-sports.io/football/teams/2382.png',
          'Estados Unidos': 'https://media.api-sports.io/football/teams/2384.png',
          'Canadá': 'https://media.api-sports.io/football/teams/5529.png',
          'Sudáfrica': 'https://media.api-sports.io/football/teams/1531.png',
          'Bosnia y Herzegovina': 'https://media.api-sports.io/football/teams/1113.png',
          'Escocia': 'https://media.api-sports.io/football/teams/1108.png',
          'Turquía': 'https://media.api-sports.io/football/teams/777.png',
          'Paraguay': 'https://media.api-sports.io/football/teams/2380.png',
          'Curazao': 'https://media.api-sports.io/football/teams/5530.png',
          'Cabo Verde': 'https://media.api-sports.io/football/teams/1533.png',
          'República Checa': 'https://media.api-sports.io/football/teams/770.png',
          'Haití': 'https://media.api-sports.io/football/teams/2386.png',
          'Nueva Zelanda': 'https://media.api-sports.io/football/teams/4673.png',
          'Irán': 'https://media.api-sports.io/football/teams/22.png',
          'Irak': 'https://media.api-sports.io/football/teams/1567.png',
          'Noruega': 'https://media.api-sports.io/football/teams/1090.png',
          'Argelia': 'https://media.api-sports.io/football/teams/1532.png',
          'Austria': 'https://media.api-sports.io/football/teams/775.png',
          'Jordania': 'https://media.api-sports.io/football/teams/1548.png',
          'Uzbekistán': 'https://media.api-sports.io/football/teams/1568.png',
          'Países Bajos': 'https://media.api-sports.io/football/teams/1118.png',
        };
        this.saveLogos();
        console.log('[MatchesService] Created default team_logos.json file with all 48 World Cup teams');
      }
    } catch (error) {
      console.error('[MatchesService Error] Failed to load team logos:', error);
    }
  }

  private saveLogos() {
    try {
      fs.writeFileSync(this.logosFilePath, JSON.stringify(this.teamLogos, null, 2), 'utf8');
    } catch (error) {
      console.error('[MatchesService Error] Failed to save team logos:', error);
    }
  }

  async isAnyMatchActiveNow(): Promise<boolean> {
    const now = new Date();
    
    // Check if any match is IN_PROGRESS
    const activeCount = await this.prisma.match.count({
      where: { status: 'IN_PROGRESS' },
    });
    if (activeCount > 0) return true;

    // Check if any match is SCHEDULED and its date is between (now - 3.5 hours) and (now + 15 minutes)
    const fifteenMinutesFromNow = new Date(now.getTime() + 15 * 60 * 1000);
    const threeAndHalfHoursAgo = new Date(now.getTime() - 210 * 60 * 1000);

    const upcomingOrOngoingCount = await this.prisma.match.count({
      where: {
        status: 'SCHEDULED',
        date: {
          gte: threeAndHalfHoursAgo,
          lte: fifteenMinutesFromNow,
        },
      },
    });

    return upcomingOrOngoingCount > 0;
  }

  // Sincronizar partidos con API-Football
  async syncMatchesWithApi(forceSync = false): Promise<{ success: boolean; message: string; details?: any }> {
    const apiKey = process.env.API_FOOTBALL_KEY || '193840fb024aae2b71d8b46d1c7d174d';
    const season = process.env.API_FOOTBALL_SEASON || '2026';
    const league = process.env.API_FOOTBALL_LEAGUE || '1';

    if (!apiKey) {
      const msg = '[API-Football Sync] API key is not configured.';
      console.warn(msg);
      return { success: false, message: msg };
    }

    if (!forceSync) {
      const isActive = await this.isAnyMatchActiveNow();
      if (!isActive) {
        console.log('[API-Football Sync] Skipped. No matches are currently playing or scheduled near this time.');
        return { success: true, message: 'Sync skipped: no active matches now.' };
      }
    }

    console.log(`[API-Football Sync] Fetching fixtures for league=${league}, season=${season}...`);

    try {
      const response = await fetch(
        `https://v3.football.api-sports.io/fixtures?league=${league}&season=${season}`,
        {
          headers: {
            'x-apisports-key': apiKey,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
      }

      const data: any = await response.json();

      if (data.errors && Object.keys(data.errors).length > 0 && !data.response?.length) {
        const errorMsg = JSON.stringify(data.errors);
        console.warn(`[API-Football Sync WARNING] API returned errors: ${errorMsg}`);
        return { success: false, message: `API returned errors: ${errorMsg}`, details: data.errors };
      }

      const fixtures = data.response || [];
      console.log(`[API-Football Sync] Found ${fixtures.length} fixtures in API response.`);

      if (fixtures.length === 0) {
        return { success: true, message: 'No fixtures returned by API.' };
      }

      const dbMatches = await this.prisma.match.findMany();
      let updatedCount = 0;
      let logosUpdated = false;

      for (const apiFixture of fixtures) {
        const apiHome = apiFixture.teams.home.name;
        const apiAway = apiFixture.teams.away.name;
        const apiHomeLogo = apiFixture.teams.home.logo;
        const apiAwayLogo = apiFixture.teams.away.logo;

        // Translate / Normalize team names
        const translatedHome = TEAM_TRANSLATIONS[apiHome] || apiHome;
        const translatedAway = TEAM_TRANSLATIONS[apiAway] || apiAway;

        // Save logos to our map
        if (apiHomeLogo && this.teamLogos[translatedHome] !== apiHomeLogo) {
          this.teamLogos[translatedHome] = apiHomeLogo;
          logosUpdated = true;
        }
        if (apiAwayLogo && this.teamLogos[translatedAway] !== apiAwayLogo) {
          this.teamLogos[translatedAway] = apiAwayLogo;
          logosUpdated = true;
        }

        // Find the match in the database
        const matchedDbMatch = dbMatches.find(dbMatch => {
          const dbHomeNorm = normalizeTeamName(dbMatch.homeTeam);
          const dbAwayNorm = normalizeTeamName(dbMatch.awayTeam);
          
          const apiHomeTranslatedNorm = normalizeTeamName(translatedHome);
          const apiAwayTranslatedNorm = normalizeTeamName(translatedAway);
          const apiHomeOriginalNorm = normalizeTeamName(apiHome);
          const apiAwayOriginalNorm = normalizeTeamName(apiAway);

          const matchesHome = dbHomeNorm === apiHomeTranslatedNorm || dbHomeNorm === apiHomeOriginalNorm;
          const matchesAway = dbAwayNorm === apiAwayTranslatedNorm || dbAwayNorm === apiAwayOriginalNorm;

          return matchesHome && matchesAway;
        });

        if (matchedDbMatch) {
          const apiStatus = apiFixture.fixture.status.short; // FT, HT, 1H, 2H, ET, etc.
          const apiHomeScore = apiFixture.goals.home;
          const apiAwayScore = apiFixture.goals.away;

          // Determine status
          let newStatus: 'SCHEDULED' | 'IN_PROGRESS' | 'FINISHED' = 'SCHEDULED';
          if (['FT', 'AET', 'PEN'].includes(apiStatus)) {
            newStatus = 'FINISHED';
          } else if (['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].includes(apiStatus)) {
            newStatus = 'IN_PROGRESS';
          }

          // Check if we need to update
          const scoreChanged = matchedDbMatch.homeScore !== apiHomeScore || matchedDbMatch.awayScore !== apiAwayScore;
          const statusChanged = matchedDbMatch.status !== newStatus;

          if (scoreChanged || statusChanged) {
            // Update in DB
            await this.prisma.match.update({
              where: { id: matchedDbMatch.id },
              data: {
                homeScore: apiHomeScore !== null ? Number(apiHomeScore) : null,
                awayScore: apiAwayScore !== null ? Number(apiAwayScore) : null,
                status: newStatus,
              },
            });

            console.log(`[API-Football Sync] Updated Match #${matchedDbMatch.num} (${matchedDbMatch.homeTeam} vs ${matchedDbMatch.awayTeam}): Status ${matchedDbMatch.status} -> ${newStatus}, Score ${matchedDbMatch.homeScore}-${matchedDbMatch.awayScore} -> ${apiHomeScore}-${apiAwayScore}`);
            updatedCount++;

            // If the match finished, trigger recalculation of predictions
            if (newStatus === 'FINISHED' && matchedDbMatch.status !== 'FINISHED') {
              console.log(`[API-Football Sync] Match #${matchedDbMatch.num} marked as FINISHED. Recalculating user predictions...`);
              await this.recalculateAllUsersPoints();
            }
          }
        }
      }

      if (logosUpdated) {
        this.saveLogos();
      }

      if (updatedCount > 0) {
        await this.recalculateKnockoutPropagation();
      }

      const msg = `[API-Football Sync] Completed. Updated ${updatedCount} matches. Logos updated: ${logosUpdated}`;
      console.log(msg);
      return { success: true, message: msg };
    } catch (error: any) {
      const errMsg = `[API-Football Sync ERROR] Failed: ${error.message || error}`;
      console.error(errMsg);
      return { success: false, message: errMsg };
    }
  }

  // Obtener el plantel de un equipo (con caché formal en base de datos)
  async getTeamSquad(teamId: number): Promise<any> {
    try {
      // 1. Intentar buscar si ya está sincronizado
      const syncRecord = await this.prisma.teamSquadSync.findUnique({
        where: { teamId },
      });

      if (syncRecord) {
        console.log(`[MatchesService] Returning DB cached squad for team ${teamId}`);
        return this.prisma.player.findMany({
          where: { teamId },
          orderBy: [
            { position: 'asc' },
            { name: 'asc' }
          ]
        });
      }

      // 2. Si no está, consultar a la API de Football
      const apiKey = process.env.API_FOOTBALL_KEY || '193840fb024aae2b71d8b46d1c7d174d';
      if (!apiKey) {
        return [];
      }

      console.log(`[MatchesService] Fetching squad from API-Football for team ${teamId}...`);
      const response = await fetch(
        `https://v3.football.api-sports.io/players/squads?team=${teamId}`,
        {
          headers: {
            'x-apisports-key': apiKey,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: any = await response.json();
      const squad = data.response?.[0]?.players || [];
      const apiTeamName = data.response?.[0]?.team?.name || `Selección ${teamId}`;

      // Fetch coach details
      console.log(`[MatchesService] Fetching coach from API-Football for team ${teamId}...`);
      let coachData = null;
      try {
        const coachResponse = await fetch(
          `https://v3.football.api-sports.io/coachs?team=${teamId}`,
          {
            headers: {
              'x-apisports-key': apiKey,
            },
          }
        );
        if (coachResponse.ok) {
          const coachResJson: any = await coachResponse.json();
          if (coachResJson.response && coachResJson.response.length > 0) {
            const coach = coachResJson.response.find((c: any) => c.career && c.career.some((job: any) => job.team.id === teamId && job.end === null)) || coachResJson.response[0];
            if (coach) {
              coachData = {
                id: -Math.abs(coach.id),
                name: coach.name,
                age: coach.age || null,
                photo: coach.photo || null,
              };
            }
          }
        }
      } catch (err) {
        console.error(`[MatchesService] Failed to fetch coach for team ${teamId}:`, err);
      }

      const mapPosition = (pos: string): 'Goalkeeper' | 'Defender' | 'Midfielder' | 'Attacker' => {
        if (pos === 'Goalkeeper') return 'Goalkeeper';
        if (pos === 'Defender') return 'Defender';
        if (pos === 'Midfielder') return 'Midfielder';
        return 'Attacker';
      };

      // 3. Guardar en la base de datos por jugador usando upsert
      for (const p of squad) {
        await this.prisma.player.upsert({
          where: { id: p.id },
          update: {
            name: p.name,
            number: p.number !== null ? Number(p.number) : null,
            age: p.age !== null ? Number(p.age) : null,
            photo: p.photo || null,
            position: mapPosition(p.position),
            teamId: teamId,
            teamName: apiTeamName,
          },
          create: {
            id: p.id,
            name: p.name,
            number: p.number !== null ? Number(p.number) : null,
            age: p.age !== null ? Number(p.age) : null,
            photo: p.photo || null,
            position: mapPosition(p.position),
            teamId: teamId,
            teamName: apiTeamName,
          }
        });
      }

      // Guardar el entrenador en la base de datos
      if (coachData) {
        await this.prisma.player.upsert({
          where: { id: coachData.id },
          update: {
            name: coachData.name,
            age: coachData.age,
            photo: coachData.photo,
            position: 'Coach',
            teamId: teamId,
            teamName: apiTeamName,
          },
          create: {
            id: coachData.id,
            name: coachData.name,
            age: coachData.age,
            photo: coachData.photo,
            position: 'Coach',
            teamId: teamId,
            teamName: apiTeamName,
          }
        });
      }

      // Marcar como sincronizado
      await this.prisma.teamSquadSync.upsert({
        where: { teamId },
        update: {},
        create: { teamId },
      });

      return this.prisma.player.findMany({
        where: { teamId },
        orderBy: [
          { position: 'asc' },
          { name: 'asc' }
        ]
      });
    } catch (error: any) {
      console.error(`[MatchesService ERROR] Failed to fetch/save squad for team ${teamId}:`, error.message || error);
      return [];
    }
  }

  async recalculateKnockoutPropagation() {
    const KNOCKOUT_INITIAL_MAP: Record<number, { homeTeam: string; awayTeam: string }> = {
      73: { homeTeam: "Sudáfrica", awayTeam: "Canadá" },
      74: { homeTeam: "Alemania", awayTeam: "Paraguay" },
      75: { homeTeam: "Países Bajos", awayTeam: "Marruecos" },
      76: { homeTeam: "Brasil", awayTeam: "Japón" },
      77: { homeTeam: "Francia", awayTeam: "Suecia" },
      78: { homeTeam: "Costa de Marfil", awayTeam: "Noruega" },
      79: { homeTeam: "México", awayTeam: "Ecuador" },
      80: { homeTeam: "Inglaterra", awayTeam: "RD Congo" },
      81: { homeTeam: "Estados Unidos", awayTeam: "Bosnia y Herzegovina" },
      82: { homeTeam: "Bélgica", awayTeam: "Senegal" },
      83: { homeTeam: "Portugal", awayTeam: "Croacia" },
      84: { homeTeam: "España", awayTeam: "Austria" },
      85: { homeTeam: "Suiza", awayTeam: "Argelia" },
      86: { homeTeam: "Argentina", awayTeam: "Cabo Verde" },
      87: { homeTeam: "Colombia", awayTeam: "Ghana" },
      88: { homeTeam: "Australia", awayTeam: "Egipto" },
      89: { homeTeam: "W74", awayTeam: "W77" },
      90: { homeTeam: "W73", awayTeam: "W75" },
      91: { homeTeam: "W76", awayTeam: "W78" },
      92: { homeTeam: "W79", awayTeam: "W80" },
      93: { homeTeam: "W83", awayTeam: "W84" },
      94: { homeTeam: "W81", awayTeam: "W82" },
      95: { homeTeam: "W86", awayTeam: "W88" },
      96: { homeTeam: "W85", awayTeam: "W87" },
      97: { homeTeam: "W89", awayTeam: "W90" },
      98: { homeTeam: "W93", awayTeam: "W94" },
      99: { homeTeam: "W91", awayTeam: "W92" },
      100: { homeTeam: "W95", awayTeam: "W96" },
      101: { homeTeam: "W97", awayTeam: "W98" },
      102: { homeTeam: "W99", awayTeam: "W100" },
      103: { homeTeam: "L101", awayTeam: "L102" },
      104: { homeTeam: "W101", awayTeam: "W102" },
    };

    console.log('[MatchesService] Starting knockout winner propagation recalculation...');

    try {
      const knockoutMatches = await this.prisma.match.findMany({
        where: { num: { gte: 73, lte: 104 } },
      });

      const matchMap = new Map<number, typeof knockoutMatches[0]>();
      knockoutMatches.forEach(m => {
        if (m.num !== null) matchMap.set(m.num, m);
      });

      const resolvedTeams: Record<number, { homeTeam: string; awayTeam: string }> = {};
      for (const num of Object.keys(KNOCKOUT_INITIAL_MAP).map(Number)) {
        resolvedTeams[num] = { ...KNOCKOUT_INITIAL_MAP[num] };
      }

      for (let num = 73; num <= 104; num++) {
        const match = matchMap.get(num);
        if (!match) continue;

        const home = resolvedTeams[num].homeTeam;
        const away = resolvedTeams[num].awayTeam;

        if (match.status === 'FINISHED' && match.homeScore !== null && match.awayScore !== null) {
          let winner = '';
          let loser = '';
          if (match.homeScore > match.awayScore) {
            winner = home;
            loser = away;
          } else if (match.awayScore > match.homeScore) {
            winner = away;
            loser = home;
          } else {
            // Tie: Check penaltyWinner to determine who advanced
            if (match.penaltyWinner === away) {
              winner = away;
              loser = home;
            } else {
              winner = home;
              loser = away;
            }
          }

          const wPlaceholder = `W${num}`;
          const lPlaceholder = `L${num}`;

          for (let nextNum = num + 1; nextNum <= 104; nextNum++) {
            if (resolvedTeams[nextNum].homeTeam === wPlaceholder) {
              resolvedTeams[nextNum].homeTeam = winner;
            }
            if (resolvedTeams[nextNum].homeTeam === lPlaceholder) {
              resolvedTeams[nextNum].homeTeam = loser;
            }
            if (resolvedTeams[nextNum].awayTeam === wPlaceholder) {
              resolvedTeams[nextNum].awayTeam = winner;
            }
            if (resolvedTeams[nextNum].awayTeam === lPlaceholder) {
              resolvedTeams[nextNum].awayTeam = loser;
            }
          }
        }
      }

      for (let num = 73; num <= 104; num++) {
        const match = matchMap.get(num);
        if (!match) continue;
        const resolved = resolvedTeams[num];
        if (match.homeTeam !== resolved.homeTeam || match.awayTeam !== resolved.awayTeam) {
          await this.prisma.match.update({
            where: { id: match.id },
            data: {
              homeTeam: resolved.homeTeam,
              awayTeam: resolved.awayTeam,
            }
          });
          console.log(`[MatchesService] Propagated bracket team update for Match #${num}: ${resolved.homeTeam} vs ${resolved.awayTeam}`);
        }
      }
      console.log('[MatchesService] Knockout winner propagation recalculation completed.');
    } catch (err) {
      console.error('[MatchesService Error] Failed to propagate knockout winners:', err);
    }
  }

  async updateResultsBulk(results: { id: string; homeScore: number; awayScore: number; penaltyWinner?: string }[]) {
    console.log(`[MatchesService] Starting bulk results update for ${results.length} matches...`);
    try {
      for (const res of results) {
        const match = await this.prisma.match.update({
          where: { id: res.id },
          data: {
            homeScore: res.homeScore,
            awayScore: res.awayScore,
            penaltyWinner: res.penaltyWinner !== undefined ? res.penaltyWinner : null,
            status: 'FINISHED',
          },
        });

        const predictions = await this.prisma.prediction.findMany({
          where: { matchId: res.id },
        });

        const isArgentina = match.homeTeam === 'Argentina' || match.awayTeam === 'Argentina';

        for (const pred of predictions) {
          let points = 0;
          if (pred.homeScore === res.homeScore && pred.awayScore === res.awayScore) {
            points = isArgentina ? 4 : 3;
          } else if (
            (pred.homeScore > pred.awayScore && res.homeScore > res.awayScore) ||
            (pred.homeScore < pred.awayScore && res.homeScore < res.awayScore) ||
            (pred.homeScore === pred.awayScore && res.homeScore === res.awayScore)
          ) {
            points = 1;
          }

          await this.prisma.prediction.update({
            where: { id: pred.id },
            data: { points },
          });
        }
      }

      await this.recalculateAllUsersPoints();
      await this.recalculateKnockoutPropagation();

      console.log('[MatchesService] Bulk results update completed successfully.');
      return { success: true, count: results.length };
    } catch (error: any) {
      console.error('[MatchesService Error] Bulk results update failed:', error);
      throw error;
    }
  }
}


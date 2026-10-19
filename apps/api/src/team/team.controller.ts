import { Controller, Get } from '@nestjs/common';
import { type Actor, Can, CurrentActor } from '../auth/decorators';
import { TeamService } from './team.service';

/** Suivi des équipes terrain (P6.1.2) : `/{app}/team/positions`. */
@Controller(':app/team')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get('positions')
  @Can('user:read')
  positions(@CurrentActor() actor: Actor) {
    return this.team.positions(actor);
  }
}

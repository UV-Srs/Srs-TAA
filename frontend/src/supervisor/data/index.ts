import { apiSupervisorService } from './apiSupervisorService';
import type { SupervisorDataService } from './SupervisorDataService';

/** The data service the supervisor screens use. Swap the implementation here. */
export const supervisorService: SupervisorDataService = apiSupervisorService;

export type { SupervisorDataService } from './SupervisorDataService';
export * from './types';

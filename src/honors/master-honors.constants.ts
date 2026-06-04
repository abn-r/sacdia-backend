export const MASTER_HONORS_QUEUE = 'master-honors';

export const MASTER_HONOR_RECALCULATION_BATCH_SIZE = 100;
export const MASTER_HONOR_RECALCULATION_BATCH_DELAY_MS = 150;

export const MASTER_HONOR_RECALCULATION_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 2000,
  },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 100 },
};

export interface MasterHonorJobUserData {
  kind: 'user';
  userId: string;
  masterHonorId?: number;
}

export interface MasterHonorJobMasterHonorData {
  kind: 'master-honor';
  masterHonorId: number;
}

export interface MasterHonorJobAllData {
  kind: 'all';
}

export type MasterHonorJob =
  | MasterHonorJobUserData
  | MasterHonorJobMasterHonorData
  | MasterHonorJobAllData;

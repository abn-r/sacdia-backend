import { Injectable } from '@nestjs/common';
import { ResolvedWeights } from './weights-resolver';

export interface ComponentScores {
  folder: number;
  finance: number;
  camporee: number;
  evidence: number;
}

@Injectable()
export class CompositeScoreService {
  compose(scores: ComponentScores, weights: ResolvedWeights): number {
    const composite =
      (scores.folder * weights.folder +
        scores.finance * weights.finance +
        scores.camporee * weights.camporee +
        scores.evidence * weights.evidence) /
      100;
    return Number(composite.toFixed(2));
  }
}

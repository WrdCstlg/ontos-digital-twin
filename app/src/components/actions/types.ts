/**
 * Row shapes for the Actions page, inferred from the actions router so they
 * follow the API as it changes.
 */
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../api/router';

type Outputs = inferRouterOutputs<AppRouter>;

export type ActionTypeRow = Outputs['actions']['listTypes'][number];
export type ActionTypeDetail = Outputs['actions']['getType'];
export type ActionTypeVersionRow = ActionTypeDetail['versions'][number];
export type ForObjectRow = Outputs['actions']['forObject'][number];

export type PreviewResult = Outputs['actions']['preview'];
export type SubmitResult = Outputs['actions']['submit'];

export type SubmissionRow = Outputs['actions']['listSubmissions'][number];
export type SubmissionDetail = Outputs['actions']['getSubmission'];
export type SideEffectRow = SubmissionDetail['sideEffects'][number];

export type PlanSummary = PreviewResult['plan'];
export type ShaclCheck = PreviewResult['shacl'];
export type CriterionResult = PreviewResult['criteria'][number];
export type Problem = PreviewResult['problems'][number];

export type FillAction =
  | 'fill'
  | 'select'
  | 'check'
  | 'click'
  | 'pause'
  | 'info'
  | 'upload';

export interface FillInstruction {
  stepId: string;
  action: FillAction;
  selector: string;
  value: string;
  label: string;
  // Populated only for 'upload' steps. The extension fetches `downloadUrl`
  // (a short-lived signed URL into Supabase Storage) and attaches the file to
  // the matched input[type=file] element using `fileName`.
  downloadUrl?: string;
  fileName?: string;
}

export interface SessionState {
  sessionId: string;
  applicationId: string;
  userId: string;
  status: 'pending' | 'active' | 'paused' | 'complete' | 'error';
  currentStep: number;
  totalSteps: number;
}

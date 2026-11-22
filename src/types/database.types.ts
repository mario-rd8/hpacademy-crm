export type EnrollmentStatus = 'pendente' | 'matriculado';

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'error';

export type QuickFilter = 'all' | 'today_tasks' | 'overdue' | 'stale';

export type AppTab = 'kanban' | 'materials' | 'settings';

export interface Profile {
  id: string;
  full_name: string;
  phone: string;
  role: string;
  created_at: string;
}

export interface Stage {
  id: string;
  name: string;
  slug: string;
  position: number;
  color: string;
  is_system: boolean;
  created_at: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface Lead {
  id: string;
  name: string;
  phone: string;
  stage_id: string;
  source: string;
  loss_reason: string | null;
  enrollment_status: EnrollmentStatus;
  has_whatsapp: boolean;
  is_returning: boolean;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
  tags: Tag[];
  tasks: Task[];
}

export interface LeadNote {
  id: string;
  lead_id: string;
  author_id: string | null;
  author_name: string;
  content: string;
  created_at: string;
}

export interface Task {
  id: string;
  lead_id: string;
  title: string;
  due_at: string;
  completed: boolean;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface MediaTemplate {
  id: string;
  title: string;
  body: string;
  file_url: string | null;
  file_name: string | null;
  file_type: string | null;
  storage_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageLog {
  id: string;
  lead_id: string;
  template_id: string | null;
  message_body: string;
  media_url: string | null;
  evolution_message_id: string | null;
  status: MessageStatus;
  error_detail: string | null;
  sent_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface LossReason {
  id: string;
  label: string;
  position: number;
  created_at: string;
}
